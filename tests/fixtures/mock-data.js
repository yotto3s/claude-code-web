/**
 * Test Fixtures - Mock Data
 *
 * Provides consistent mock data for tests.
 */

/**
 * Create a mock session object
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock session
 */
export function createMockSession(overrides = {}) {
  const now = Date.now();
  return {
    id: 'test-session-' + Math.random().toString(36).substr(2, 9),
    name: 'Test Session',
    workingDirectory: '/tmp/test',
    mode: 'plan',
    createdAt: now,
    lastActivity: now,
    webSearchEnabled: false,
    sdkSessionId: null,
    ...overrides,
  };
}

/**
 * Create a mock message object
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock message
 */
export function createMockMessage(overrides = {}) {
  return {
    role: 'user',
    content: 'Hello, Claude!',
    timestamp: Date.now(),
    ...overrides,
  };
}

/**
 * Create a mock HTTP request object
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock request
 */
export function createMockRequest(overrides = {}) {
  return {
    headers: {},
    cookies: {},
    socket: {
      remoteAddress: '127.0.0.1',
    },
    ip: '127.0.0.1',
    ...overrides,
  };
}

/**
 * Create a mock HTTP response object
 * @returns {Object} Mock response with spy methods
 */
export function createMockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    cookies: {},
    data: null,
  };

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  res.json = (data) => {
    res.data = data;
    return res;
  };

  res.send = (data) => {
    res.data = data;
    return res;
  };

  res.cookie = (name, value, options) => {
    res.cookies[name] = { value, options };
    return res;
  };

  res.clearCookie = (name, _options) => {
    delete res.cookies[name];
    return res;
  };

  res.setHeader = (name, value) => {
    res.headers[name] = value;
    return res;
  };

  return res;
}

/**
 * Create a mock WebSocket object
 * @returns {Object} Mock WebSocket with spy methods
 */
export function createMockWebSocket() {
  const messages = [];
  const ws = {
    readyState: 1, // OPEN
    messages,
    send: (data) => {
      messages.push(JSON.parse(data));
    },
    close: () => {
      ws.readyState = 3; // CLOSED
    },
    on: () => {},
    once: () => {},
    removeListener: () => {},
  };
  return ws;
}

/**
 * Sample session data for database tests
 */
export const sampleSessions = [
  {
    id: 'session-1',
    name: 'Development Session',
    workingDirectory: '/home/user/project',
    mode: 'plan',
    createdAt: Date.now() - 3600000, // 1 hour ago
    lastActivity: Date.now() - 1800000, // 30 minutes ago
  },
  {
    id: 'session-2',
    name: 'Testing Session',
    workingDirectory: '/home/user/tests',
    mode: 'plan',
    createdAt: Date.now() - 7200000, // 2 hours ago
    lastActivity: Date.now() - 3600000, // 1 hour ago
  },
];

/**
 * Sample messages for database tests
 */
export const sampleMessages = [
  { role: 'user', content: 'Hello!', timestamp: Date.now() - 60000 },
  { role: 'assistant', content: 'Hi there! How can I help?', timestamp: Date.now() - 55000 },
  { role: 'user', content: 'Can you help me with code?', timestamp: Date.now() - 50000 },
];

/**
 * Create a mock terminal object
 * @param {Object} overrides - Properties to override
 * @returns {Object} Mock terminal
 */
export function createMockTerminal(overrides = {}) {
  return {
    id: 'term-' + Math.random().toString(36).substr(2, 9),
    name: 'Terminal 1',
    cwd: '/tmp/test',
    isConnected: true,
    ...overrides,
  };
}

/**
 * Create a list of mock terminals for a session
 * @param {string} sessionId - Session ID that owns the terminals
 * @param {number} count - Number of terminals to create
 * @returns {Array} Array of mock terminals
 */
export function createMockTerminalList(sessionId, count = 2) {
  return Array.from({ length: count }, (_, i) =>
    createMockTerminal({
      id: `term-${sessionId}-${i + 1}`,
      name: `Terminal ${i + 1}`,
    })
  );
}

/**
 * Sample terminal data for tests
 */
export const sampleTerminals = [
  {
    id: 'term-1',
    name: 'Terminal 1',
    cwd: '/home/user/project',
    isConnected: true,
  },
  {
    id: 'term-2',
    name: 'Terminal 2',
    cwd: '/home/user/project',
    isConnected: false,
  },
];
