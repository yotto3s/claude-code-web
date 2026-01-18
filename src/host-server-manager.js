/**
 * Host Server Manager
 * Manages connection to a single server running on the host machine
 * instead of spawning per-user containers
 */

class HostServerManager {
  constructor() {
    // Host server configuration
    this.hostIP = process.env.HOST_SERVER_IP || 'host.docker.internal';
    this.hostPort = parseInt(process.env.HOST_SERVER_PORT || '3001', 10);
    
    // For older Docker versions that don't support host.docker.internal
    // You can set HOST_SERVER_IP to the Docker bridge IP (usually 172.17.0.1)
    if (this.hostIP === 'auto') {
      this.hostIP = this.detectHostIP();
    }
    
    console.log(`Host Server Manager configured: ${this.hostIP}:${this.hostPort}`);
  }

  /**
   * Detect the host IP from inside the Docker container
   */
  detectHostIP() {
    // On Linux, the Docker bridge gateway is typically 172.17.0.1
    // On Mac/Windows with Docker Desktop, use host.docker.internal
    const os = require('os');
    const interfaces = os.networkInterfaces();
    
    // Try to find docker0 interface
    if (interfaces.docker0 && interfaces.docker0.length > 0) {
      return '172.17.0.1';
    }
    
    // Default to host.docker.internal (works on Docker Desktop)
    return 'host.docker.internal';
  }

  /**
   * Check if the host server is running and accessible
   */
  async isServerRunning() {
    return new Promise((resolve) => {
      const http = require('http');
      
      const options = {
        hostname: this.hostIP,
        port: this.hostPort,
        path: '/api/health',
        method: 'GET',
        timeout: 2000
      };

      const req = http.request(options, (res) => {
        resolve(res.statusCode === 200);
      });

      req.on('error', () => {
        resolve(false);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }

  /**
   * Get the target (IP and port) for proxying requests
   * Always returns the same host server
   */
  async getTarget(username) {
    return {
      ip: this.hostIP,
      port: this.hostPort
    };
  }

  /**
   * "Start" a session for a user (no-op, server is always running)
   * @param {Object} userInfo - User information from PAM auth
   * @returns {Promise<{success: boolean, ip: string, port: number}>}
   */
  async startSession(userInfo) {
    const { username } = userInfo;
    
    console.log(`Checking host server for user ${username}...`);
    
    // Check if server is accessible
    const isRunning = await this.isServerRunning();
    
    if (!isRunning) {
      return {
        success: false,
        error: 'Host server is not running or not accessible. Make sure the server is running on the host at port ' + this.hostPort
      };
    }

    console.log(`Host server is accessible for ${username}`);
    return {
      success: true,
      ip: this.hostIP,
      port: this.hostPort
    };
  }

  /**
   * "Stop" a session for a user (no-op, server keeps running)
   */
  async stopSession(username) {
    // Sessions are managed by the host server itself
    console.log(`Session cleanup for ${username} handled by host server`);
    return { success: true };
  }

  /**
   * Check if the server is accessible (health check)
   */
  async healthCheck() {
    return await this.isServerRunning();
  }
}

// Export singleton instance
const hostServerManager = new HostServerManager();

module.exports = {
  HostServerManager,
  hostServerManager
};
