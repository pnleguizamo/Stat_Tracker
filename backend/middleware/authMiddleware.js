const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const token = req.cookies?.auth;

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  /*
    guestPayload = {
      sub: impersonate,
      gid,
      guest: true,
      displayName: 'Guest',
    };

    spotifyUserPayload = { sub: accountId }
  */ 
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.accountId = payload.sub;
    req.authPayload = payload;
    next();
  } catch (err) {
    console.error('JWT verify error', err);
    return res.status(401).json({ error: 'Invalid or expired auth token' });
  }
}

module.exports = { authenticate };
