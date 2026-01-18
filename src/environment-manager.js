const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ENVIRONMENT_DIR = path.join(DATA_DIR, 'environment');

class EnvironmentManager {
  constructor() {
    this.ensureDirectories();
  }

  ensureDirectories() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(ENVIRONMENT_DIR)) {
      fs.mkdirSync(ENVIRONMENT_DIR, { recursive: true });
    }
  }

  getEnvironmentPath() {
    return ENVIRONMENT_DIR;
  }

  ensureEnvironment() {
    this.ensureDirectories();
    return { path: ENVIRONMENT_DIR };
  }
}

const environmentManager = new EnvironmentManager();

module.exports = { environmentManager };
