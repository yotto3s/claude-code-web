/**
 * PAM Authentication Module
 * Authenticates users against the host system using /etc/passwd and /etc/shadow
 * For security, this requires the server to have read access to /etc/shadow
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const crypto = require('crypto');

/**
 * Parse /etc/passwd to get user info
 */
function getUserFromPasswd(username) {
  try {
    const passwd = fs.readFileSync('/etc/passwd', 'utf8');
    for (const line of passwd.split('\n')) {
      const parts = line.split(':');
      if (parts[0] === username) {
        return {
          username: parts[0],
          uid: parseInt(parts[2], 10),
          gid: parseInt(parts[3], 10),
          home: parts[5],
          shell: parts[6]
        };
      }
    }
  } catch (err) {
    console.error('Failed to read /etc/passwd:', err.message);
  }
  return null;
}

/**
 * Get password hash from /etc/shadow
 */
function getPasswordHash(username) {
  try {
    const shadow = fs.readFileSync('/etc/shadow', 'utf8');
    for (const line of shadow.split('\n')) {
      const parts = line.split(':');
      if (parts[0] === username) {
        return parts[1];
      }
    }
  } catch (err) {
    console.error('Failed to read /etc/shadow:', err.message);
  }
  return null;
}

/**
 * Verify password against shadow hash
 * Uses mkpasswd which supports all formats including yescrypt ($y$)
 */
function verifyPassword(password, hash) {
  if (!hash || hash === '*' || hash === '!' || hash === '!!' || hash.startsWith('!')) {
    return false; // Account is locked or has no password
  }

  try {
    // Parse the hash to extract algorithm and salt
    // Format: $algorithm$salt$hash or $algorithm$params$salt$hash
    const parts = hash.split('$');
    if (parts.length < 4) {
      console.error('Invalid hash format');
      return false;
    }

    // Determine the method and salt based on algorithm
    const algorithm = parts[1];
    let method, salt;
    
    switch (algorithm) {
      case 'y': // yescrypt - format: $y$params$salt$hash
        method = 'yescrypt';
        salt = `$${parts[1]}$${parts[2]}$${parts[3]}`;
        break;
      case '6': // SHA-512 - format: $6$salt$hash
        method = 'sha-512';
        salt = `$${parts[1]}$${parts[2]}`;
        break;
      case '5': // SHA-256 - format: $5$salt$hash
        method = 'sha-256';
        salt = `$${parts[1]}$${parts[2]}`;
        break;
      case '1': // MD5 - format: $1$salt$hash
        method = 'md5';
        salt = `$${parts[1]}$${parts[2]}`;
        break;
      default:
        console.error(`Unsupported hash algorithm: ${algorithm}`);
        return false;
    }

    // Use mkpasswd to generate hash with same salt
    // Escape single quotes in password
    const escapedPassword = password.replace(/'/g, "'\\''");
    const result = execSync(
      `echo -n '${escapedPassword}' | mkpasswd -s -m ${method} -S '${salt}'`,
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    
    // Compare with timing-safe comparison
    if (result.length !== hash.length) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(result), Buffer.from(hash));
  } catch (err) {
    console.error('Password verification error:', err.message);
  }
  
  return false;
}

/**
 * Authenticate a user against the system
 * @param {string} username - The username to authenticate
 * @param {string} password - The password to verify
 * @returns {Promise<{success: boolean, uid?: number, gid?: number, home?: string, error?: string}>}
 */
async function authenticate(username, password) {
  // Validate input
  if (!username || !password) {
    return { success: false, error: 'Username and password required' };
  }

  // Sanitize username (prevent injection)
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return { success: false, error: 'Invalid username format' };
  }

  // Get user info from /etc/passwd
  const userInfo = getUserFromPasswd(username);
  if (!userInfo) {
    return { success: false, error: 'User not found' };
  }

  // Get password hash from /etc/shadow
  const hash = getPasswordHash(username);
  if (!hash) {
    return { success: false, error: 'Cannot verify credentials' };
  }

  // Verify password
  if (!verifyPassword(password, hash)) {
    return { success: false, error: 'Invalid credentials' };
  }

  return {
    success: true,
    uid: userInfo.uid,
    gid: userInfo.gid,
    home: userInfo.home,
    username: userInfo.username
  };
}

/**
 * Get user information from the system (from /etc/passwd)
 * @param {string} username - The username to look up
 * @returns {Promise<{uid: number, gid: number, home: string} | null>}
 */
async function getUserInfo(username) {
  // Sanitize username
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return null;
  }

  return getUserFromPasswd(username);
}

module.exports = {
  authenticate,
  getUserInfo
};
