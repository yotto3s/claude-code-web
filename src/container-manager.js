/**
 * User Container Manager
 * Manages per-user Docker containers with proper isolation
 */

const { spawn, exec } = require('child_process');
const crypto = require('crypto');

class UserContainerManager {
  constructor() {
    // Map of username -> container info
    this.containers = new Map();
    
    // Container image name
    this.imageName = 'claude-code-user';
    
    // Docker network name for container communication
    this.networkName = 'claude-code-network';
    
    // Internal port used by user containers
    this.internalPort = 3000;
  }

  /**
   * Get container name for a user
   */
  getContainerName(username) {
    return `claude-user-${username}`;
  }

  /**
   * Ensure the Docker network exists for container-to-container communication
   */
  async ensureNetwork() {
    return new Promise((resolve) => {
      exec(`docker network inspect ${this.networkName} 2>/dev/null`, (error) => {
        if (error) {
          // Network doesn't exist, create it
          exec(`docker network create ${this.networkName}`, (createError) => {
            if (createError) {
              console.error(`Failed to create network: ${createError.message}`);
            } else {
              console.log(`Created Docker network: ${this.networkName}`);
            }
            resolve(!createError);
          });
        } else {
          resolve(true);
        }
      });
    });
  }

  /**
   * Check if a container is running for a user
   */
  async isContainerRunning(username) {
    const containerName = this.getContainerName(username);
    
    return new Promise((resolve) => {
      exec(`docker inspect -f '{{.State.Running}}' ${containerName} 2>/dev/null`, (error, stdout) => {
        if (error) {
          resolve(false);
        } else {
          resolve(stdout.trim() === 'true');
        }
      });
    });
  }

  /**
   * Get container IP address on the network
   */
  async getContainerIP(username) {
    const containerName = this.getContainerName(username);
    
    return new Promise((resolve) => {
      exec(`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${containerName} 2>/dev/null`, (error, stdout) => {
        if (error) {
          resolve(null);
        } else {
          resolve(stdout.trim() || null);
        }
      });
    });
  }

  /**
   * Get container info if running
   */
  async getContainerInfo(username) {
    const containerName = this.getContainerName(username);
    
    return new Promise((resolve) => {
      exec(`docker inspect ${containerName} 2>/dev/null`, (error, stdout) => {
        if (error) {
          resolve(null);
        } else {
          try {
            const info = JSON.parse(stdout)[0];
            const networks = info.NetworkSettings.Networks;
            const ip = networks[this.networkName]?.IPAddress || 
                       Object.values(networks)[0]?.IPAddress;
            resolve({
              id: info.Id,
              running: info.State.Running,
              ip,
              port: this.internalPort
            });
          } catch {
            resolve(null);
          }
        }
      });
    });
  }

  /**
   * Start a container for a user
   * @param {Object} userInfo - User information from PAM auth
   * @param {string} userInfo.username - Username
   * @param {number} userInfo.uid - User ID
   * @param {number} userInfo.gid - Group ID
   * @param {string} userInfo.home - Home directory path
   * @returns {Promise<{success: boolean, ip?: string, port?: number, error?: string}>}
   */
  async startContainer(userInfo) {
    const { username, uid, gid, home } = userInfo;
    const containerName = this.getContainerName(username);

    // Ensure network exists
    await this.ensureNetwork();

    // Check if already running
    if (await this.isContainerRunning(username)) {
      console.log(`Container already running for user ${username}`);
      const ip = await this.getContainerIP(username);
      return { success: true, ip, port: this.internalPort, existing: true };
    }

    // Stop and remove existing container if it exists
    await this.stopContainer(username);

    return new Promise((resolve) => {
      // Build docker run command
      // Use Docker network for container-to-container communication
      const args = [
        'run',
        '-d',  // Detached mode
        '--rm',  // Remove when stopped
        '--name', containerName,
        '--network', this.networkName,  // Join the shared network
        '-u', `${uid}:${gid}`,  // Run as the user
        '-v', `${home}:${home}`,  // Mount user's home directory
        '-v', `${home}/.claude:/home/node/.claude`,  // Mount claude config
        '-e', `HOME=${home}`,  // Set home environment
        '-e', `USER=${username}`,
        '-e', `LOGNAME=${username}`,
        '-e', 'PORT=3000',
        '-e', 'HOST=0.0.0.0',
        // Pass through API key if available
        ...(process.env.ANTHROPIC_API_KEY ? ['-e', `ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY}`] : []),
        this.imageName
      ];

      console.log(`Starting container for user ${username}: docker ${args.join(' ')}`);

      const docker = spawn('docker', args);

      let stdout = '';
      let stderr = '';

      docker.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      docker.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      docker.on('close', async (code) => {
        if (code === 0) {
          const containerId = stdout.trim();
          
          // Get the container's IP address
          const ip = await this.getContainerIP(username);
          
          this.containers.set(username, {
            id: containerId,
            ip,
            port: this.internalPort,
            uid,
            gid,
            home,
            startedAt: Date.now()
          });

          console.log(`Container started for ${username}: ${containerId.substring(0, 12)} (IP: ${ip})`);
          resolve({ success: true, ip, port: this.internalPort, containerId });
        } else {
          console.error(`Failed to start container for ${username}: ${stderr}`);
          resolve({ success: false, error: stderr || 'Failed to start container' });
        }
      });

      docker.on('error', (err) => {
        console.error(`Docker error for ${username}:`, err);
        resolve({ success: false, error: err.message });
      });
    });
  }

  /**
   * Stop a user's container
   */
  async stopContainer(username) {
    const containerName = this.getContainerName(username);

    return new Promise((resolve) => {
      exec(`docker stop ${containerName} 2>/dev/null; docker rm -f ${containerName} 2>/dev/null`, (error) => {
        this.containers.delete(username);
        resolve(!error);
      });
    });
  }

  /**
   * Get the port for a user's container
   */
  getPort(username) {
    const container = this.containers.get(username);
    return container ? container.port : this.internalPort;
  }

  /**
   * Get the IP and port for a user's container
   */
  async getTarget(username) {
    const container = this.containers.get(username);
    if (container && container.ip) {
      return { ip: container.ip, port: container.port };
    }
    
    // Try to get IP from Docker
    const ip = await this.getContainerIP(username);
    if (ip) {
      return { ip, port: this.internalPort };
    }
    
    return null;
  }

  /**
   * List all running containers
   */
  listContainers() {
    const list = [];
    for (const [username, info] of this.containers) {
      list.push({
        username,
        ...info
      });
    }
    return list;
  }

  /**
   * Stop all user containers
   */
  async stopAll() {
    const promises = [];
    for (const username of this.containers.keys()) {
      promises.push(this.stopContainer(username));
    }
    await Promise.all(promises);
  }

  /**
   * Ensure the user container image is built
   */
  async ensureImage() {
    return new Promise((resolve) => {
      exec(`docker image inspect ${this.imageName} 2>/dev/null`, (error) => {
        if (error) {
          console.log('User container image not found, needs to be built');
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  /**
   * Build the user container image
   */
  async buildImage(dockerfilePath = './Dockerfile.user') {
    return new Promise((resolve, reject) => {
      console.log('Building user container image...');
      
      const docker = spawn('docker', ['build', '-t', this.imageName, '-f', dockerfilePath, '.'], {
        stdio: 'inherit'
      });

      docker.on('close', (code) => {
        if (code === 0) {
          console.log('User container image built successfully');
          resolve(true);
        } else {
          reject(new Error(`Failed to build image, exit code: ${code}`));
        }
      });

      docker.on('error', (err) => {
        reject(err);
      });
    });
  }
}

// Singleton instance
const containerManager = new UserContainerManager();

module.exports = {
  containerManager,
  UserContainerManager
};
