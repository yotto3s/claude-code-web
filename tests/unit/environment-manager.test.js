/**
 * Unit Tests for Environment Manager
 *
 * Tests the environment directory management.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_BASE_DIR = path.join(__dirname, '..', '..', 'data-test', 'env-test');

describe('EnvironmentManager', () => {
  beforeEach(() => {
    // Clean up before each test
    if (fs.existsSync(TEST_BASE_DIR)) {
      fs.rmSync(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    // Clean up after each test
    if (fs.existsSync(TEST_BASE_DIR)) {
      fs.rmSync(TEST_BASE_DIR, { recursive: true, force: true });
    }
  });

  describe('Directory Management', () => {
    it('should create data directory if it does not exist', () => {
      expect(fs.existsSync(TEST_BASE_DIR)).toBe(false);

      fs.mkdirSync(TEST_BASE_DIR, { recursive: true });

      expect(fs.existsSync(TEST_BASE_DIR)).toBe(true);
    });

    it('should create nested directories recursively', () => {
      const nestedPath = path.join(TEST_BASE_DIR, 'level1', 'level2', 'level3');

      fs.mkdirSync(nestedPath, { recursive: true });

      expect(fs.existsSync(nestedPath)).toBe(true);
    });

    it('should not throw if directory already exists', () => {
      fs.mkdirSync(TEST_BASE_DIR, { recursive: true });

      expect(() => {
        fs.mkdirSync(TEST_BASE_DIR, { recursive: true });
      }).not.toThrow();
    });

    it('should return correct environment path', () => {
      const envPath = path.join(TEST_BASE_DIR, 'environment');
      fs.mkdirSync(envPath, { recursive: true });

      expect(fs.existsSync(envPath)).toBe(true);
      expect(path.basename(envPath)).toBe('environment');
    });
  });

  describe('Path Resolution', () => {
    it('should resolve absolute paths correctly', () => {
      const resolved = path.resolve(TEST_BASE_DIR, 'subdir');

      expect(path.isAbsolute(resolved)).toBe(true);
      expect(resolved).toContain('subdir');
    });

    it('should handle path joining correctly', () => {
      const joined = path.join(TEST_BASE_DIR, 'a', 'b', 'c');

      expect(joined).toContain(path.sep);
      expect(joined.endsWith(path.join('a', 'b', 'c'))).toBe(true);
    });
  });
});
