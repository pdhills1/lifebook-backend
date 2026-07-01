const { supabaseAdmin } = require('../lib/supabase');

/**
 * Verifies the Authorization: Bearer <token> header against Supabase,
 * then attaches { id, email, profile } to req.user for downstream routes.
 * Auto-creates a profile row on first sight of a brand-new user (the
 * profile itself, not the book — bootstrap handles the book/chapters).
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return res.status(401).json({ error: 'Invalid or expired auth token' });
  }

  const authUser = userData.user;

  let { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();

  if (profileError) {
    return res.status(500).json({ error: 'Failed to load user profile' });
  }

  if (!profile) {
    const displayName = authUser.email ? authUser.email.split('@')[0] : 'Author';
    const { data: created, error: createError } = await supabaseAdmin
      .from('profiles')
      .insert({ id: authUser.id, display_name: displayName, role: 'author' })
      .select()
      .single();
    if (createError) {
      return res.status(500).json({ error: 'Failed to create user profile' });
    }
    profile = created;
  }

  req.user = { id: authUser.id, email: authUser.email, profile };
  next();
}

/** Use after requireAuth on routes that only admins may call. */
function requireAdmin(req, res, next) {
  if (req.user?.profile?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
