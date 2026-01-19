/**
 * Test Setup File
 *
 * Configures the test environment before running tests.
 * Sets up test database directory and cleanup.
 */

import { beforeAll, afterAll, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test data directory (separate from production)
export const TEST_DATA_DIR = path.join(__dirname, '..', 'data-test');
export const TEST_DB_PATH = path.join(TEST_DATA_DIR, 'sessions.db');

// Set test environment
process.env.NODE_ENV = 'test';

beforeAll(() => {
  // Ensure test data directory exists
  if (!fs.existsSync(TEST_DATA_DIR)) {
    fs.mkdirSync(TEST_DATA_DIR, { recursive: true });
  }
});

afterEach(() => {
  // Clear all mocks after each test
  vi.clearAllMocks();
});

afterAll(() => {
  // Cleanup test database after all tests
  try {
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn('Could not clean up test data directory:', err.message);
  }
});

/**
 * Helper to create a fresh test database instance
 */
export function createTestDatabase() {
  // Remove existing test DB if present
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  // Also remove WAL files if present
  const walPath = TEST_DB_PATH + '-wal';
  const shmPath = TEST_DB_PATH + '-shm';
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

  return TEST_DB_PATH;
}
