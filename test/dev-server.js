// Runs the real website against the in-memory fake (no Supabase needed): node test/dev-server.js
process.env.SUPABASE_URL = 'https://fake.supabase.co'; process.env.SUPABASE_SECRET_KEY = 's'; process.env.SUPABASE_PUBLISHABLE_KEY = 'p';
process.env.ADMIN_EMAILS = 'boss@example.com';
const { makeFake } = require('./fake'); const { __setClients } = require('../server/lib/supabase');
const f = makeFake(); __setClients({ admin: f.admin, anon: f.anon });
require('../server/index').createApp().listen(process.env.PORT || 3999, () => console.log('dev on', process.env.PORT || 3999));
