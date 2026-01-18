const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const { sessionManager } = require('./src/session-manager');
const { setupWebSocket } = require('./src/websocket');

const app = express();
const server = http.createServer(app);

// Configuration
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Parse users from environment: "user1:hash1,user2:hash2"
const USERS = new Map();
if (process.env.USERS) {
  process.env.USERS.split(',').forEach(entry => {
    const [username, hash] = entry.split(':');
    if (username && hash) USERS.set(username.trim(), hash.trim());
  });
}

// Session secret for signing cookies
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

// Sign/verify session tokens
function createSessionToken(username) {
  const data = JSON.stringify({ username, exp: Date.now() + 24 * 60 * 60 * 1000 });
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
  return Buffer.from(data).toString('base64') + '.' + signature;
}

function verifySessionToken(token) {
  if (!token) return null;
  const [data, signature] = token.split('.');
  if (!data || !signature) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(Buffer.from(data, 'base64').toString()).digest('hex');
  if (signature !== expected) return null;
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64').toString());
    if (parsed.exp < Date.now()) return null;
    return parsed.username;
  } catch { return null; }
}

// Auth middleware
function requireAuth(req, res, next) {
  // If no users configured, skip auth (single-user mode)
  if (USERS.size === 0) {
    req.username = 'default';
    return next();
  }

  const username = verifySessionToken(req.cookies.session);
  if (!username) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.username = username;
  next();
}

// Export for websocket module
module.exports.verifySessionToken = verifySessionToken;
module.exports.USERS = USERS;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Trust proxy for correct IP detection
app.set('trust proxy', true);

// Serve static files from public directory (CSS, JS)
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));

// Login page (public)
app.get('/login', (req, res) => {
  // If no users configured, redirect to main page
  if (USERS.size === 0) {
    return res.redirect('/');
  }
  // If already authenticated, redirect to main page
  const username = verifySessionToken(req.cookies.session);
  if (username) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login API
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  // If no users configured, deny login
  if (USERS.size === 0) {
    return res.status(401).json({ error: 'No users configured' });
  }

  const storedHash = USERS.get(username);
  if (!storedHash) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Compare password hash (SHA256)
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  if (hash !== storedHash) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = createSessionToken(username);
  res.cookie('session', token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 24 * 60 * 60 * 1000 });
  res.json({ success: true, username });
});

// Logout
app.post('/api/logout', (req, res) => {
  res.clearCookie('session', { path: '/' });
  res.json({ success: true });
});

// Main chat interface - requires auth
app.get('/', (req, res, next) => {
  // If users are configured, check auth
  if (USERS.size > 0) {
    const username = verifySessionToken(req.cookies.session);
    if (!username) {
      return res.redirect('/login');
    }
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoints - all protected
app.get('/api/sessions', requireAuth, (req, res) => {
  const sessions = sessionManager.listSessions();
  res.json({ sessions });
});

app.post('/api/sessions', requireAuth, (req, res) => {
  const { workingDirectory } = req.body;
  const session = sessionManager.createSession(workingDirectory);
  res.json({ session: { id: session.id, createdAt: session.createdAt } });
});

app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const success = sessionManager.terminateSession(id);
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Session not found' });
  }
});

// Home directory endpoint - returns user's home directory
app.get('/api/home', requireAuth, (req, res) => {
  // If users are configured, use /home/{username}
  if (USERS.size > 0 && req.username !== 'default') {
    res.json({ home: path.join('/home', req.username) });
  } else {
    res.json({ home: os.homedir() });
  }
});

// Directory listing API for browser
const fs = require('fs');
app.get('/api/directories', requireAuth, (req, res) => {
  // Determine user's home directory
  let homeDir;
  if (USERS.size > 0 && req.username !== 'default') {
    homeDir = path.join('/home', req.username);
  } else {
    homeDir = os.homedir();
  }

  const requestedPath = req.query.path || homeDir;

  try {
    // Resolve the path
    const resolvedPath = path.resolve(requestedPath);

    // Security: Ensure path is under user's home directory
    if (!resolvedPath.startsWith(homeDir)) {
      return res.status(403).json({ error: 'Access denied: Path outside home directory' });
    }

    // Check if path exists and is a directory
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'Path does not exist' });
    }

    const stat = fs.statSync(resolvedPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    // Read directory contents
    const entries = fs.readdirSync(resolvedPath, { withFileTypes: true });

    // Filter to only directories, exclude hidden folders
    const directories = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(entry => ({
        name: entry.name,
        path: path.join(resolvedPath, entry.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      path: resolvedPath,
      directories
    });
  } catch (err) {
    if (err.code === 'EACCES') {
      return res.status(403).json({ error: 'Permission denied' });
    }
    res.status(500).json({ error: err.message });
  }
});

// Setup WebSocket
setupWebSocket(server);

// Start server
server.listen(PORT, HOST, () => {
  const authMode = USERS.size > 0
    ? `Multi-user (${USERS.size} user${USERS.size > 1 ? 's' : ''})`
    : 'Single-user (no auth)';

  console.log('');
  console.log('\x1b[36m╔══════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[36m║\x1b[0m  \x1b[1mClaude Code Web Server\x1b[0m                              \x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m                                                      \x1b[36m║\x1b[0m');
  console.log(`\x1b[36m║\x1b[0m  Listening: \x1b[32mhttp://${HOST}:${PORT}\x1b[0m`.padEnd(63) + '\x1b[36m║\x1b[0m');
  console.log('\x1b[36m║\x1b[0m                                                      \x1b[36m║\x1b[0m');
  console.log(`\x1b[36m║\x1b[0m  Mode: \x1b[32m${authMode}\x1b[0m`.padEnd(63) + '\x1b[36m║\x1b[0m');
  console.log('\x1b[36m╚══════════════════════════════════════════════════════╝\x1b[0m');
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  sessionManager.terminateAll();
  server.close(() => {
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  sessionManager.terminateAll();
  server.close(() => {
    process.exit(0);
  });
});
