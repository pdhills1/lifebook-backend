const config = require('../config');
const { getAdmin } = require('./supabase');

const photos = () => getAdmin().storage.from(config.photosBucket);
const pdfs = () => getAdmin().storage.from(config.pdfsBucket);

/** Creates the two private buckets on first start, so there is no manual dashboard step. */
async function ensureBuckets() {
  const storage = getAdmin().storage;
  const { data: existing, error } = await storage.listBuckets();
  if (error) throw new Error(`Could not read storage: ${error.message}`);
  const have = new Set((existing || []).map((b) => b.name));
  const made = [];
  for (const name of [config.photosBucket, config.pdfsBucket]) {
    if (have.has(name)) continue;
    const res = await storage.createBucket(name, { public: false });
    if (res.error && !/already exists/i.test(res.error.message)) {
      throw new Error(`Could not create the "${name}" bucket: ${res.error.message}`);
    }
    made.push(name);
  }
  return made;
}

/** Signed links for many photos in one request. Returns { path: url }. */
async function signedUrls(paths, seconds = 3600) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  const { data, error } = await photos().createSignedUrls(unique, seconds);
  if (error) throw new Error(`Could not create photo links: ${error.message}`);
  const out = {};
  for (const row of data || []) if (row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}

async function signedPdfUrl(path, downloadName, seconds = 3600) {
  const { data, error } = await pdfs().createSignedUrl(path, seconds, downloadName ? { download: downloadName } : undefined);
  if (error) throw new Error(`Could not create the download link: ${error.message}`);
  return data.signedUrl;
}

async function upload(bucket, path, buffer, contentType) {
  const { error } = await bucket.upload(path, buffer, { contentType, upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);
}

async function download(bucket, path) {
  const { data, error } = await bucket.download(path);
  if (error || !data) throw new Error(`Could not read ${path}: ${error?.message || 'empty'}`);
  return Buffer.from(await data.arrayBuffer());
}

async function remove(bucket, paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  const { error } = await bucket.remove(list);
  if (error) throw new Error(`Could not delete files: ${error.message}`);
}

/** Deletes everything stored under a user's folder in one bucket (folders are nested one level). */
async function removeFolder(bucket, folder) {
  const { data: top } = await bucket.list(folder, { limit: 1000 });
  const files = [];
  for (const item of top || []) {
    if (item.id) { files.push(`${folder}/${item.name}`); continue; }
    const { data: inner } = await bucket.list(`${folder}/${item.name}`, { limit: 1000 });
    for (const f of inner || []) if (f.id) files.push(`${folder}/${item.name}/${f.name}`);
  }
  await remove(bucket, files);
  return files.length;
}

module.exports = { photos, pdfs, ensureBuckets, signedUrls, signedPdfUrl, upload, download, remove, removeFolder };
