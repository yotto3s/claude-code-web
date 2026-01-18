/**
 * Gateway Server
 * 
 * This is the main entry point that:
 * 1. Handles user authentication against the host system (PAM)
 * 2. Spawns per-user Docker containers
 * 3. Proxies requests to the user's container
 */

const express = require('express');
const http = require('http');
const httpProxy = require('http-proxy');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const WebSocket = require('ws');

const { authenticate, getUserInfo } = require('./src/pam-auth');
const { containerManager } = require('./src/container-manager');

const app = express();
const server = http.createServer(app);

// Create proxy server
const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true
});

// Configuration
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Session secret for signing cookies
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Active user sessions: username -> { token, userInfo, containerPort }
const userSessions = new Map();

// Sign/verify session tokens
function createSessionToken(username, userInfo) {
  const data = JSON.stringify({
    username,
    uid: userInfo.uid,
    gid: userInfo.gid,
    home: userInfo.home,
    exp: Date.now() + 24 * 60 * 60 * 1000  // 24 hours
  });
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
  return Buffer.from(data).toString('base64') + '.' + signature;
}

function verifySessionToken(token) {
  if (!token) return null;
  const [data, signature] = token.split('.');
  if (!data || !signature) return null;
  
  const expected = crypto.createHmac('sha256', SESSION_SECRET)
    .update(Buffer.from(data, 'base64').toString())
    .digest('hex');
  
  if (signature !== expected) return null;
  
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64').toString());
    if (parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Trust proxy for correct IP detection
app.set('trust proxy', true);

// Serve static files for login page
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));

// Login page
app.get('/login', (req, res) => {
  // If already authenticated with valid container, redirect to main page
  const sessionData = verifySessionToken(req.cookies.session);
  if (sessionData) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login API - authenticate against host system
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  console.log(`Login attempt for user: ${username}`);

  // Authenticate against PAM
  const authResult = await authenticate(username, password);

  if (!authResult.success) {
    console.log(`Authentication failed for ${username}: ${authResult.error}`);
    return res.status(401).json({ error: authResult.error || 'Invalid credentials' });
  }

  console.log(`Authentication successful for ${username} (UID: ${authResult.uid}, GID: ${authResult.gid})`);

  // Start or connect to user's container
  console.log(`Starting container for ${username}...`);
  const containerResult = await containerManager.startContainer({
    username: authResult.username,
    uid: authResult.uid,
    gid: authResult.gid,
    home: authResult.home
  });

  if (!containerResult.success) {
    console.error(`Failed to start container for ${username}: ${containerResult.error}`);
    return res.status(500).json({ error: 'Failed to start user environment' });
  }

  // Wait a moment for the container to be ready
  if (!containerResult.existing) {
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  // Create session
  const userInfo = {
    uid: authResult.uid,
    gid: authResult.gid,
    home: authResult.home
  };

  const token = createSessionToken(username, userInfo);
  
  userSessions.set(username, {
    token,
    userInfo,
    containerIP: containerResult.ip,
    containerPort: containerResult.port
  });

  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000
  });

  console.log(`User ${username} logged in, container: ${containerResult.ip}:${containerResult.port}`);
  res.json({ success: true, username });
});

// Logout
app.post('/api/logout', async (req, res) => {
  const sessionData = verifySessionToken(req.cookies.session);
  
  if (sessionData) {
    console.log(`User ${sessionData.username} logging out`);
    // Optionally stop the container
    // await containerManager.stopContainer(sessionData.username);
    userSessions.delete(sessionData.username);
  }

  res.clearCookie('session', { path: '/' });
  res.json({ success: true });
});

// Container status endpoint
app.get('/api/container/status', async (req, res) => {
  const sessionData = verifySessionToken(req.cookies.session);
  
  if (!sessionData) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const running = await containerManager.isContainerRunning(sessionData.username);
  const target = await containerManager.getTarget(sessionData.username);

  res.json({
    username: sessionData.username,
    running,
    ip: target?.ip,
    port: target?.port
  });
});

// Ensure container is running and get target (IP and port)
async function ensureContainer(sessionData) {
  const { username, uid, gid, home } = sessionData;
  
  console.log(`ensureContainer for ${username}: uid=${uid}, gid=${gid}, home=${home}`);
  
  // Check if container is running and get its IP
  if (await containerManager.isContainerRunning(username)) {
    return await containerManager.getTarget(username);
  }

  // Start container
  const result = await containerManager.startContainer({ username, uid, gid, home });
  if (result.success) {
    // Wait for container to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));
    return { ip: result.ip, port: result.port };
  }

  return null;
}

// Auth middleware for proxied routes
async function authMiddleware(req, res, next) {
  const sessionData = verifySessionToken(req.cookies.session);
  
  if (!sessionData) {
    // For API calls, return JSON error
    if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    // For page requests, redirect to login
    return res.redirect('/login');
  }

  req.sessionData = sessionData;
  
  // Ensure container is running
  const target = await ensureContainer(sessionData);
  if (!target || !target.ip) {
    return res.status(503).json({ error: 'User environment not available' });
  }
  
  req.containerTarget = target;
  next();
}

// Proxy all authenticated requests to user's container
app.use('/', authMiddleware, (req, res) => {
  const target = `http://${req.containerTarget.ip}:${req.containerTarget.port}`;
  
  proxy.web(req, res, { target }, (err) => {
    console.error(`Proxy error for ${req.sessionData.username}:`, err.message);
    
    if (!res.headersSent) {
      res.status(502).json({ error: 'User environment temporarily unavailable' });
    }
  });
});

// Handle proxy errors
proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err.message);
  if (res.writeHead && !res.headersSent) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy error' }));
  }
});

// WebSocket upgrade handling
server.on('upgrade', async (req, socket, head) => {
  // Parse cookies manually
  const cookies = {};
  if (req.headers.cookie) {
    req.headers.cookie.split(';').forEach(cookie => {
      const [name, ...rest] = cookie.trim().split('=');
      if (name) cookies[name] = decodeURIComponent(rest.join('='));
    });
  }

  const sessionData = verifySessionToken(cookies.session);
  
  if (!sessionData) {
    console.log('WebSocket upgrade rejected: no valid session');
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Ensure container is running
  const target = await ensureContainer(sessionData);
  if (!target || !target.ip) {
    console.log(`WebSocket upgrade rejected: no container for ${sessionData.username}`);
    socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    socket.destroy();
    return;
  }

  const wsTarget = `ws://${target.ip}:${target.port}`;
  console.log(`Proxying WebSocket for ${sessionData.username} to ${wsTarget}`);

  proxy.ws(req, socket, head, { target: wsTarget }, (err) => {
    console.error(`WebSocket proxy error for ${sessionData.username}:`, err.message);
    socket.destroy();
  });
});

// Start server
server.listen(PORT, HOST, async () => {
  // Ensure container image exists
  const hasImage = await containerManager.ensureImage();
  if (!hasImage) {
    console.log('\x1b[33mWarning: User container image not built. Run: docker build -t claude-code-user -f Dockerfile.user .\x1b[0m');
  }

  console.log('');
  console.log('\x1b[36m╔══════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[36m║\x1b[0m  \x1b[1mClaude Code Web Gateway\x1b[0m                             \x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m                                                      \x1b[36m║\x1b[0m');
  console.log(`\x1b[36m║\x1b[0m  Listening: \x1b[32mhttp://${HOST}:${PORT}\x1b[0m`.padEnd(63) + '\x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m                                                      \x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m  Auth: \x1b[32mPAM (System Users)\x1b[0m                           \x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m  Mode: \x1b[32mPer-user containers\x1b[0m                          \x1b[36m║\x1b[0m');
  console.log('\x1b[36m╚══════════════════════════════════════════════════════╝\x1b[0m');
  console.log('');
});

// Graceful shutdown with force timeout
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) {
    console.log('Force shutdown!');
    process.exit(1);
  }
  shuttingDown = true;
  console.log('Shutting down... (press Ctrl+C again to force)');
  
  // Force exit after 3 seconds
  const forceTimeout = setTimeout(() => {
    console.log('Force shutdown after timeout');
    process.exit(1);
  }, 3000);
  forceTimeout.unref();
  
  try {
    await containerManager.stopAll();
  } catch (e) {
    console.error('Error stopping containers:', e.message);
  }
  
  server.close(() => {
    clearTimeout(forceTimeout);
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
