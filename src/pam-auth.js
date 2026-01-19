/**
 * PAM Authentication Module
 *
 * Authenticates users against /etc/passwd and /etc/shadow
 * mounted from the host system into the Docker container.
 */

const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');

/**
 * Parse /etc/passwd to get user info
 */
function parsePasswd() {
  try {
    const content = fs.readFileSync('/etc/passwd', 'utf8');
    const users = {};

    content.split('\n').forEach((line) => {
      if (!line.trim()) return;
      const parts = line.split(':');
      if (parts.length >= 7) {
        const [username, , uid, gid, gecos, home, shell] = parts;
        users[username] = {
          username,
          uid: parseInt(uid, 10),
          gid: parseInt(gid, 10),
          gecos,
          home,
          shell,
        };
      }
    });

    return users;
  } catch (err) {
    console.error('Error reading /etc/passwd:', err.message);
    return {};
  }
}

/**
 * Parse /etc/shadow to get password hashes
 */
function parseShadow() {
  try {
    const content = fs.readFileSync('/etc/shadow', 'utf8');
    const hashes = {};

    content.split('\n').forEach((line) => {
      if (!line.trim()) return;
      const parts = line.split(':');
      if (parts.length >= 2) {
        const [username, hash] = parts;
        hashes[username] = hash;
      }
    });

    return hashes;
  } catch (err) {
    console.error('Error reading /etc/shadow:', err.message);
    return {};
  }
}

/**
 * Verify password against shadow hash using Python's crypt module
 */
function verifyPassword(password, hash) {
  // Handle special hash values
  if (!hash || hash === '*' || hash === '!' || hash === '!!' || hash.startsWith('!')) {
    return false; // Account locked or no password
  }

  try {
    // Use Python's crypt module which properly handles all hash formats
    // including yescrypt, sha-512, sha-256, md5, bcrypt, etc.
    const pythonScript = `
import crypt
import sys
password = sys.stdin.read()
stored_hash = sys.argv[1]
generated = crypt.crypt(password, stored_hash)
print('match' if generated == stored_hash else 'nomatch')
`;

    const result = execSync(
      `python3 -c "${pythonScript.replace(/"/g, '\\"')}" '${hash.replace(/'/g, "'\\''")}'`,
      {
        encoding: 'utf8',
        timeout: 5000,
        input: password,
      }
    ).trim();

    return result === 'match';
  } catch (err) {
    console.error('Error verifying password:', err.message);
    return false;
  }
}

/**
 * Authenticate user against PAM (via /etc/passwd and /etc/shadow)
 */
async function authenticate(username, password) {
  if (!username || !password) {
    return { success: false, error: 'Username and password required' };
  }

  // Get user info from /etc/passwd
  const users = parsePasswd();
  const userInfo = users[username];

  if (!userInfo) {
    return { success: false, error: 'User not found' };
  }

  // Get password hash from /etc/shadow
  const hashes = parseShadow();
  const hash = hashes[username];

  if (!hash) {
    return { success: false, error: 'Unable to verify credentials' };
  }

  // Verify password
  const valid = verifyPassword(password, hash);

  if (!valid) {
    return { success: false, error: 'Invalid password' };
  }

  return {
    success: true,
    username: userInfo.username,
    uid: userInfo.uid,
    gid: userInfo.gid,
    home: userInfo.home,
  };
}

/**
 * Get user info by username
 */
function getUserInfo(username) {
  const users = parsePasswd();
  return users[username] || null;
}

module.exports = {
  authenticate,
  getUserInfo,
};
