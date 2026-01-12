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

    // socket.accountId = payload.guest ? null : payload.sub;
    socket.accountId = payload.guest ? 'preethika.naveen' : payload.sub;
    socket.authPayload = payload;
    return next();
  } catch (err) {
    return next(new Error('Authentication error'));
  }
}

module.exports = { socketAuthMiddleware };
