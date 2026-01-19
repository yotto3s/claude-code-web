function getClientIP(req) {
  // Check various headers for the real IP
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || req.ip;
}

// Simple pass-through middleware for single-user mode
async function authMiddleware(req, res, next) {
  const clientIP = getClientIP(req);

  req.auth = {
    type: 'local',
    ip: clientIP,
  };

  return next();
}

module.exports = {
  authMiddleware,
  getClientIP,
};
