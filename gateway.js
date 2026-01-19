/**
 * Hybrid Gateway Server
 *
 * This gateway runs in a Docker container (Ubuntu 24.04) and:
 * 1. Handles user authentication against the host system (PAM via /etc/passwd, /etc/shadow)
 * 2. Issues signed JWT-like session cookies (24-hour expiry)
 * 3. Proxies HTTP requests and WebSocket connections to the host server
 *
 * Environment Variables:
 * - HOST_SERVER_IP: IP address of host server (default: host.docker.internal or 172.17.0.1)
 * - HOST_SERVER_PORT: Port of host server (default: 3001)
 * - SESSION_SECRET: Secret for signing session cookies (auto-generated if not set)
 * - PORT: Gateway listen port (default: 3000)
 *
 * @module gateway
 */

const express = require('express');
const http = require('http');
const httpProxy = require('http-proxy');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const cookieParser = require('cookie-parser');

const { authenticate } = require('./src/pam-auth');
const { hostServerManager } = require('./src/host-server-manager');

const app = express();
const server = http.createServer(app);

// Create proxy server
const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true,
});

// Configuration
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Session secret persistence - load from file or create new one
const SESSION_SECRET_PATH = '/data/.session-secret';

function loadOrCreateSessionSecret() {
  // First check environment variable
  if (process.env.SESSION_SECRET) {
    console.log('Using session secret from environment variable');
    return process.env.SESSION_SECRET;
  }

  // Try to read from persistent file
  try {
    if (fs.existsSync(SESSION_SECRET_PATH)) {
      const secret = fs.readFileSync(SESSION_SECRET_PATH, 'utf8').trim();
      if (secret && secret.length >= 32) {
        console.log('Loaded session secret from file');
        return secret;
      }
    }
  } catch (err) {
    console.warn('Could not read session secret file:', err.message);
  }

  // Generate new secret
  const newSecret = crypto.randomBytes(32).toString('hex');

  // Try to persist it
  try {
    // Ensure directory exists
    const secretDir = path.dirname(SESSION_SECRET_PATH);
    if (!fs.existsSync(secretDir)) {
      fs.mkdirSync(secretDir, { recursive: true });
    }
    fs.writeFileSync(SESSION_SECRET_PATH, newSecret, { mode: 0o600 });
    console.log('Generated and saved new session secret');
  } catch (err) {
    console.warn('Could not save session secret:', err.message);
    console.log('Using ephemeral session secret (sessions will not persist across restarts)');
  }

  return newSecret;
}

const SESSION_SECRET = loadOrCreateSessionSecret();

/** @type {Map<string, {token: string, userInfo: object}>} Active user sessions */
const userSessions = new Map();

/**
 * Create a signed session token for a user.
 * Token format: base64(JSON data) + '.' + HMAC-SHA256 signature
 * Token includes user info (uid, gid, home) and expires after 24 hours.
 *
 * @param {string} username - The username
 * @param {object} userInfo - User info from PAM (uid, gid, home)
 * @returns {string} Signed session token
 */
function createSessionToken(username, userInfo) {
  const data = JSON.stringify({
    username,
    uid: userInfo.uid,
    gid: userInfo.gid,
    home: userInfo.home,
    exp: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  });
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
  return Buffer.from(data).toString('base64') + '.' + signature;
}

/**
 * Verify and decode a session token.
 * Handles URL-encoded tokens from browser cookies.
 *
 * @param {string} token - The session token to verify
 * @returns {object|null} Decoded session data (username, uid, gid, home) or null if invalid
 */
function verifySessionToken(token) {
  if (!token) return null;
  // URL-decode the token in case browser encoded it
  token = decodeURIComponent(token);
  const [data, signature] = token.split('.');
  if (!data || !signature) return null;

  const expected = crypto
    .createHmac('sha256', SESSION_SECRET)
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
  // If already authenticated, redirect to main page
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

  console.log(
    `Authentication successful for ${username} (UID: ${authResult.uid}, GID: ${authResult.gid})`
  );

  // Check if host server is accessible
  console.log(`Checking host server accessibility...`);
  const sessionResult = await hostServerManager.startSession({
    username: authResult.username,
    uid: authResult.uid,
    gid: authResult.gid,
    home: authResult.home,
  });

  if (!sessionResult.success) {
    console.error(`Host server not accessible: ${sessionResult.error}`);
    return res.status(500).json({ error: sessionResult.error || 'Host server not accessible' });
  }

  // Create session
  const userInfo = {
    uid: authResult.uid,
    gid: authResult.gid,
    home: authResult.home,
  };

  const token = createSessionToken(username, userInfo);

  userSessions.set(username, {
    token,
    userInfo,
  });

  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
  });

  console.log(
    `User ${username} logged in, proxying to host server at ${sessionResult.ip}:${sessionResult.port}`
  );
  res.json({ success: true, username });
});

// Logout
app.post('/api/logout', async (req, res) => {
  const sessionData = verifySessionToken(req.cookies.session);

  if (sessionData) {
    console.log(`User ${sessionData.username} logging out`);
    userSessions.delete(sessionData.username);
  }

  res.clearCookie('session', { path: '/' });
  res.json({ success: true });
});

// Server status endpoint
app.get('/api/server/status', async (req, res) => {
  const sessionData = verifySessionToken(req.cookies.session);

  if (!sessionData) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const target = await hostServerManager.getTarget(sessionData.username);
  const isRunning = await hostServerManager.isServerRunning();

  res.json({
    username: sessionData.username,
    running: isRunning,
    ip: target.ip,
    port: target.port,
    mode: 'host',
  });
});

// Get target for proxying
async function getProxyTarget(sessionData) {
  return await hostServerManager.getTarget(sessionData.username);
}

// Auth middleware for proxied routes
async function proxyAuth(req, res, next) {
  const sessionData = verifySessionToken(req.cookies.session);

  if (!sessionData) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Attach session data for logging
  req.sessionData = sessionData;

  // Get proxy target
  const target = await getProxyTarget(sessionData);

  if (!target) {
    return res.status(500).json({ error: 'Unable to connect to host server' });
  }

  req.proxyTarget = target;
  next();
}

// Proxy all other API requests to host server
app.all('/api/*', proxyAuth, (req, res) => {
  const target = req.proxyTarget;
  const targetUrl = `http://${target.ip}:${target.port}`;

  console.log(`Proxying ${req.method} ${req.path} -> ${targetUrl}`);

  // Fix: express.json() consumes the body, so we need to re-attach it for the proxy
  if (req.body && Object.keys(req.body).length > 0) {
    const bodyData = JSON.stringify(req.body);
    req.headers['content-length'] = Buffer.byteLength(bodyData);

    // Store for proxy to use
    proxy.web(
      req,
      res,
      {
        target: targetUrl,
        buffer: require('stream').Readable.from([bodyData]),
      },
      (err) => {
        console.error(`Proxy error for ${req.path}:`, err.message);
        if (!res.headersSent) {
          res.status(502).json({ error: 'Bad Gateway - Host server not responding' });
        }
      }
    );
  } else {
    proxy.web(
      req,
      res,
      {
        target: targetUrl,
      },
      (err) => {
        console.error(`Proxy error for ${req.path}:`, err.message);
        if (!res.headersSent) {
          res.status(502).json({ error: 'Bad Gateway - Host server not responding' });
        }
      }
    );
  }
});

// Auth middleware for page routes (redirects to login instead of 401)
async function pageAuth(req, res, next) {
  const sessionData = verifySessionToken(req.cookies.session);

  if (!sessionData) {
    return res.redirect('/login');
  }

  req.sessionData = sessionData;

  const target = await getProxyTarget(sessionData);

  if (!target) {
    return res.status(500).send('Unable to connect to host server');
  }

  req.proxyTarget = target;
  next();
}

// Proxy main page and other routes
app.get('/', pageAuth, (req, res) => {
  const target = req.proxyTarget;
  const targetUrl = `http://${target.ip}:${target.port}`;

  proxy.web(
    req,
    res,
    {
      target: targetUrl,
    },
    (err) => {
      console.error(`Proxy error for /:`, err.message);
      if (!res.headersSent) {
        res.status(502).send('Host server not responding');
      }
    }
  );
});

// WebSocket proxy with auth
server.on('upgrade', async (req, socket, head) => {
  // Extract cookie from request
  const cookies = {};
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    cookieHeader.split(';').forEach((cookie) => {
      const [name, ...rest] = cookie.split('=');
      cookies[name.trim()] = rest.join('=').trim();
    });
  }

  const sessionData = verifySessionToken(cookies.session);

  if (!sessionData) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  const target = await getProxyTarget(sessionData);

  if (!target) {
    socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    socket.destroy();
    return;
  }

  const targetUrl = `http://${target.ip}:${target.port}`;
  console.log(`WebSocket upgrade for ${sessionData.username} -> ${targetUrl}`);

  proxy.ws(
    req,
    socket,
    head,
    {
      target: targetUrl,
    },
    (err) => {
      console.error(`WebSocket proxy error:`, err.message);
      socket.destroy();
    }
  );
});

// Health check endpoint (no auth required)
app.get('/health', async (req, res) => {
  const serverRunning = await hostServerManager.healthCheck();
  res.json({
    status: 'ok',
    gateway: 'running',
    hostServer: serverRunning ? 'accessible' : 'not accessible',
  });
});

// Start server
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  Claude Code Web - Hybrid Gateway                   ║');
  console.log('║                                                      ║');
  console.log(`║  Gateway:     http://${HOST}:${PORT.toString().padEnd(24)} ║`);
  console.log(
    `║  Host Server: ${hostServerManager.hostIP}:${hostServerManager.hostPort.toString().padEnd(21)} ║`
  );
  console.log('║                                                      ║');
  console.log('║  Auth: PAM (System Users)                           ║');
  console.log('║  Mode: Gateway in Docker, Sessions on Host          ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
