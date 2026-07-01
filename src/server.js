require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { requireAuth, requireAdmin } = require('./lib/auth');
const bootstrapRoutes = require('./routes/bootstrap');
const bookRoutes = require('./routes/book');
const answerRoutes = require('./routes/answers');
const peopleRoutes = require('./routes/people');
const finishRoutes = require('./routes/finish');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

// All routes below require a valid logged-in user.
app.use('/api', requireAuth);

app.use('/api', bootstrapRoutes);
app.use('/api', bookRoutes);
app.use('/api', answerRoutes);
app.use('/api', peopleRoutes);
app.use('/api', finishRoutes);

// Admin routes require both a valid login AND role === 'admin'.
app.use('/api', requireAdmin, adminRoutes);

// Centralized error handler — catches anything thrown/rejected in routes
// that wasn't already caught, so the client always gets a clean JSON
// error instead of an HTML stack trace or a hung connection.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err.message?.includes('File too large')) {
    return res.status(422).json({ error: 'Photo file is too large (max 15MB)' });
  }
  res.status(500).json({ error: 'Something went wrong on our end' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Lifebook backend listening on port ${PORT}`);
});
