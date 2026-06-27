const supabase = require('../services/supabase');

// Requires a valid Supabase session (GitHub OAuth) whose verified email matches
// ALLOWED_EMAIL. There is no per-user data model in this app — every table is
// shared — so this is a single-user allow-list, not row-level access control.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing Authorization header' });

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  const allowedEmail = (process.env.ALLOWED_EMAIL || '').toLowerCase();
  const userEmail = (data.user.email || '').toLowerCase();
  if (!allowedEmail || userEmail !== allowedEmail) {
    return res.status(403).json({ error: 'This account is not authorised to use this app' });
  }

  req.user = data.user;
  next();
}

module.exports = { requireAuth };
