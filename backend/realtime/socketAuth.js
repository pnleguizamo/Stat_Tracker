const jwt = require('jsonwebtoken');
const cookie = require('cookie');

function socketAuthMiddleware(socket, next) {
  try {
    const cookieHeader = socket.handshake.headers?.cookie || '';
    const cookies = cookie.parse(cookieHeader || '');
    const token = cookies.auth;

    if (!token){
      console.log('Authentication error: no auth cookie');
      return next(new Error('Authentication error: no auth cookie'));
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
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.log('Authentication error: invalid token');
      return next(new Error('Authentication error: invalid token'));
    }

    if (!payload || !payload.sub) {
      console.log('Authentication error: missing account id');
      return next(new Error('Authentication error: missing account id'));
    }

    const isGuest = !!payload.guest;
    const playerId = isGuest ? `g:${payload.gid}` : `u:${payload.sub}`;

    if (!playerId || playerId.endsWith(':')) {
      console.log('Authentication error: missing player id');
      return next(new Error('Authentication error: missing player id'));
    }

    socket.accountId = isGuest ? null : payload.sub;
    socket.authPayload = payload;
    socket.isGuest = isGuest;
    socket.playerId = playerId;

    return next();
  } catch (err) {
    return next(new Error('Authentication error'));
  }
}

module.exports = { socketAuthMiddleware };
