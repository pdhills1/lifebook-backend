// A small in-memory stand-in for Supabase (database, auth and storage) so the whole API can be tested offline.
const crypto = require('crypto');
const uid = () => crypto.randomUUID();

const CASCADE = { books: [['entries', 'book_id']], entries: [['answers', 'entry_id'], ['bonus_photos', 'entry_id']], profiles: [['books', 'owner_id']] };
const UNIQUE = { answers: ['entry_id', 'question_id'], books: ['owner_id'], profiles: ['id'] };

function makeFake() {
  const tables = { profiles: [], books: [], entries: [], answers: [], bonus_photos: [] };
  const users = new Map(), tokens = new Map(), refresh = new Map();
  const buckets = new Map();
  const stats = { queries: 0, maxRows: 0 };

  function cascade(table, rows) {
    for (const r of rows) for (const [child, col] of CASCADE[table] || []) {
      const kids = tables[child].filter((x) => x[col] === r.id);
      tables[child] = tables[child].filter((x) => x[col] !== r.id); cascade(child, kids);
    }
  }
  class Q {
    constructor(table) { this.table = table; this.op = 'select'; this.filters = []; this.ord = []; this.ret = false; }
    select() { if (this.op !== 'select') this.ret = true; return this; }
    insert(rows) { this.op = 'insert'; this.rows = rows; return this; }
    update(p) { this.op = 'update'; this.patch = p; return this; }
    upsert(r, o) { this.op = 'upsert'; this.rows = r; this.conflict = o?.onConflict; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    in(c, v) { this.filters.push((r) => v.includes(r[c])); return this; }
    order(c, o) { this.ord.push([c, o?.ascending !== false]); return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    limit(n) { this.lim = n; return this; }
    maybeSingle() { this.single_ = 'maybe'; return this; }
    single() { this.single_ = 'one'; return this; }
    then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
    run() {
      stats.queries++;
      const T = tables[this.table], match = (r) => this.filters.every((f) => f(r));
      let out = [];
      const stamp = (r) => ({ id: uid(), created_at: new Date().toISOString(), ...(this.table === 'books' ? { status: 'in_progress', title: 'My Story', skipped_chapters: [], pdf_is_final: false, updated_at: new Date().toISOString() } : {}), ...(this.table === 'profiles' ? { role: 'author' } : {}), ...(['entries', 'bonus_photos'].includes(this.table) ? { sort_order: 0 } : {}), ...r });
      const dup = (r) => UNIQUE[this.table] && T.find((x) => UNIQUE[this.table].every((c) => x[c] === r[c]));
      if (this.op === 'insert') {
        for (const r of [].concat(this.rows)) {
          if (dup(r)) return { data: null, error: { code: '23505', message: 'duplicate key value' } };
          const row = stamp(r); T.push(row); out.push(row);
        }
      } else if (this.op === 'upsert') {
        const r = this.rows, ex = dup(r);
        if (ex) { Object.assign(ex, r); out = [ex]; } else { const row = stamp(r); T.push(row); out = [row]; }
      } else if (this.op === 'update') {
        out = T.filter(match); out.forEach((r) => Object.assign(r, this.patch));
      } else if (this.op === 'delete') {
        const gone = T.filter(match); tables[this.table] = T.filter((r) => !match(r)); cascade(this.table, gone); out = gone;
      } else out = T.filter(match);
      for (const [c, asc] of [...this.ord].reverse()) out = [...out].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      if (this.op === 'select') {
        if (this.rng) out = out.slice(this.rng[0], Math.min(this.rng[1] + 1, this.rng[0] + 1000)); // PostgREST caps at 1000
        else out = out.slice(0, 1000);
        if (this.lim) out = out.slice(0, this.lim);
        stats.maxRows = Math.max(stats.maxRows, out.length);
      }
      out = out.map((r) => ({ ...r }));
      if (this.single_) {
        if (out.length > 1) return { data: null, error: { message: 'multiple rows' } };
        if (!out.length) return this.single_ === 'maybe' ? { data: null, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
        return { data: out[0], error: null };
      }
      return { data: this.op === 'select' || this.ret ? out : null, error: null };
    }
  }
  const mint = (user) => {
    const access = 'at_' + uid(), ref = 'rt_' + uid();
    tokens.set(access, user.id); refresh.set(ref, user.id);
    return { access_token: access, refresh_token: ref, expires_at: Math.floor(Date.now() / 1000) + 3600 };
  };
  const pub = (u) => ({ id: u.id, email: u.email, user_metadata: u.user_metadata });
  const authUser = (id) => users.get(id);
  const admin = {
    from: (t) => new Q(t),
    auth: {
      getUser: async (tok) => { const id = tokens.get(tok); return id && users.has(id) ? { data: { user: pub(users.get(id)) }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }; },
      admin: {
        createUser: async ({ email, password, user_metadata }) => {
          if ([...users.values()].some((u) => u.email === email)) return { data: null, error: { message: 'A user with this email address has already been registered' } };
          const u = { id: uid(), email, password, user_metadata }; users.set(u.id, u); return { data: { user: pub(u) }, error: null };
        },
        updateUserById: async (id, p) => { const u = users.get(id); if (!u) return { error: { message: 'not found' } }; if (p.password) u.password = p.password; return { error: null }; },
        deleteUser: async (id) => { users.delete(id); const p = tables.profiles.filter((x) => x.id === id); tables.profiles = tables.profiles.filter((x) => x.id !== id); cascade('profiles', p); return { error: null }; },
        generateLink: async ({ email }) => ({ data: { properties: { action_link: `https://example.test/recover?e=${email}` } }, error: null }),
      },
    },
    storage: {
      listBuckets: async () => ({ data: [...buckets.keys()].map((name) => ({ name })), error: null }),
      createBucket: async (n) => { buckets.set(n, new Map()); return { error: null }; },
      from(name) {
        if (!buckets.has(name)) buckets.set(name, new Map());
        const b = buckets.get(name);
        return {
          upload: async (p, buf) => { b.set(p, Buffer.from(buf)); return { error: null }; },
          download: async (p) => (b.has(p) ? { data: { arrayBuffer: async () => { const x = b.get(p); return x.buffer.slice(x.byteOffset, x.byteOffset + x.length); } }, error: null } : { data: null, error: { message: 'Object not found' } }),
          remove: async (ps) => { ps.forEach((p) => b.delete(p)); return { error: null }; },
          list: async (folder) => {
            const seen = new Map();
            for (const p of b.keys()) if (p.startsWith(folder + '/')) { const rest = p.slice(folder.length + 1).split('/'); seen.set(rest[0], rest.length === 1 ? { name: rest[0], id: uid() } : { name: rest[0], id: null }); }
            return { data: [...seen.values()], error: null };
          },
          createSignedUrls: async (ps) => ({ data: ps.map((path) => ({ path, signedUrl: b.has(path) ? `https://files.test/${name}/${path}` : null })), error: null }),
          createSignedUrl: async (p) => (b.has(p) ? { data: { signedUrl: `https://files.test/${name}/${p}` }, error: null } : { data: null, error: { message: 'not found' } }),
        };
      },
    },
  };
  const anon = {
    auth: {
      signInWithPassword: async ({ email, password }) => {
        const u = [...users.values()].find((x) => x.email === email && x.password === password);
        return u ? { data: { session: mint(u), user: pub(u) }, error: null } : { data: null, error: { message: 'Invalid login credentials' } };
      },
      refreshSession: async ({ refresh_token }) => {
        const id = refresh.get(refresh_token); const u = id && users.get(id);
        return u ? { data: { session: mint(u), user: pub(u) }, error: null } : { data: null, error: { message: 'bad refresh' } };
      },
    },
  };
  return { admin, anon, tables, users, buckets, stats };
}
module.exports = { makeFake };
