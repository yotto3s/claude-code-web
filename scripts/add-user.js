#!/usr/bin/env node

const crypto = require('crypto');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Users file location
const USERS_FILE = path.join(__dirname, '..', 'data', 'users.conf');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function loadUsers() {
  const users = new Map();
  if (fs.existsSync(USERS_FILE)) {
    const content = fs.readFileSync(USERS_FILE, 'utf8');
    content.split('\n').forEach(line => {
      line = line.trim();
      if (line && !line.startsWith('#')) {
        const [username, hash] = line.split(':');
        if (username && hash) {
          users.set(username.trim(), hash.trim());
        }
      }
    });
  }
  return users;
}

function saveUsers(users) {
  // Ensure data directory exists
  const dataDir = path.dirname(USERS_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const lines = ['# Claude Code Web - Users file', '# Format: username:sha256hash', ''];
  users.forEach((hash, username) => {
    lines.push(`${username}:${hash}`);
  });
  lines.push('');

  fs.writeFileSync(USERS_FILE, lines.join('\n'));
}

async function main() {
  const args = process.argv.slice(2);

  // Check for --list flag
  if (args[0] === '--list' || args[0] === '-l') {
    const users = loadUsers();
    if (users.size === 0) {
      console.log('No users configured.');
    } else {
      console.log('Configured users:');
      users.forEach((_, username) => console.log(`  - ${username}`));
    }
    process.exit(0);
  }

  // Check for --delete flag
  if (args[0] === '--delete' || args[0] === '-d') {
    const username = args[1];
    if (!username) {
      console.error('Usage: add-user --delete <username>');
      process.exit(1);
    }
    const users = loadUsers();
    if (users.delete(username)) {
      saveUsers(users);
      console.log(`User "${username}" deleted.`);
    } else {
      console.error(`User "${username}" not found.`);
      process.exit(1);
    }
    process.exit(0);
  }

  // Check for command line arguments (non-interactive)
  if (args.length >= 2) {
    const username = args[0];
    const password = args[1];
    const users = loadUsers();
    users.set(username, hashPassword(password));
    saveUsers(users);
    console.log(`User "${username}" added to ${USERS_FILE}`);
    process.exit(0);
  }

  console.log('╔════════════════════════════════════╗');
  console.log('║  Claude Code Web - Add User        ║');
  console.log('╚════════════════════════════════════╝\n');

  // Load existing users from file
  const users = loadUsers();

  if (users.size > 0) {
    console.log('Existing users:');
    users.forEach((_, username) => console.log(`  - ${username}`));
    console.log('');
  }

  // Get username
  const username = await question('Username: ');
  if (!username.trim()) {
    console.error('Error: Username cannot be empty');
    process.exit(1);
  }

  // Check if user already exists
  if (users.has(username.trim())) {
    const overwrite = await question(`User "${username}" exists. Overwrite? (y/N): `);
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Cancelled.');
      process.exit(0);
    }
  }

  // Get password
  const password = await question('Password: ');
  if (!password) {
    console.error('Error: Password cannot be empty');
    process.exit(1);
  }

  if (password.length < 4) {
    console.error('Error: Password must be at least 4 characters');
    process.exit(1);
  }

  // Confirm password
  const confirm = await question('Confirm password: ');
  if (password !== confirm) {
    console.error('Error: Passwords do not match');
    process.exit(1);
  }

  rl.close();

  // Save user
  users.set(username.trim(), hashPassword(password));
  saveUsers(users);

  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log(`User "${username}" saved to ${USERS_FILE}`);
  console.log('Run ./start.sh to start the server with authentication enabled.');
  console.log('════════════════════════════════════════════════════════════════════');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
