const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const config = require('./config');
const storage = require('./lib/storage');
const mailer = require('./lib/mailer');
const { authenticate, requireAdmin } = require('./lib/auth');
const { bookSchema } = require('./lib/schema');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://*.supabase.co'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    const problems = config.problems();
    res.json({ ok: problems.length === 0, problems });
  });
  app.get('/api/config', (_req, res) => res.json({
    productName: config.productName,
    inviteRequired: !!config.inviteCode,
    emailEnabled: mailer.enabled(),
    setupComplete: config.problems().length === 0,
  }));
  app.get('/api/schema', (_req, res) => res.json(bookSchema));

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/admin', authenticate, requireAdmin, require('./routes/admin'));
  for (const r of ['book', 'answers', 'people', 'build']) app.use('/api', authenticate, require(`./routes/${r}`));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  app.use(express.static(path.join(__dirname, '..', 'public'), {
    setHeaders(res, file) {
      if (/\.(woff2?|ttf)$/.test(file)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'That photo is too large. Please choose one under 20 MB.' });
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({
      error: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message,
      ...(err.details ? { details: err.details } : {}),
    });
  });
  return app;
}

if (require.main === module) {
  const app = createApp();
  const problems = config.problems();
  if (problems.length) console.warn('Setup incomplete:\n - ' + problems.join('\n - '));
  else storage.ensureBuckets().catch((e) => console.error('Could not prepare storage:', e.message));
  app.listen(config.port, () => console.log(`${config.productName} running on port ${config.port}`));
}
module.exports = { createApp };
