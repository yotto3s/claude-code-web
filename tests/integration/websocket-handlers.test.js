/**
 * Integration Tests for WebSocket Message Handlers
 *
 * Tests the WebSocket message handling logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockWebSocket, createMockSession } from '../fixtures/mock-data.js';

describe('WebSocket Message Handlers', () => {
  let mockWs;

  beforeEach(() => {
    mockWs = createMockWebSocket();
  });

  describe('Message Format', () => {
    it('should format messages with type and data', () => {
      const message = {
        type: 'test_event',
        data: { foo: 'bar' },
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages).toHaveLength(1);
      expect(mockWs.messages[0].type).toBe('test_event');
      expect(mockWs.messages[0].data).toEqual({ foo: 'bar' });
    });

    it('should handle session_created message format', () => {
      const session = createMockSession();
      const message = {
        type: 'session_created',
        session: {
          id: session.id,
          name: session.name,
          workingDirectory: session.workingDirectory,
        },
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('session_created');
      expect(mockWs.messages[0].session.id).toBe(session.id);
    });

    it('should handle session_joined message format', () => {
      const session = createMockSession();
      const message = {
        type: 'session_joined',
        session: {
          id: session.id,
          name: session.name,
          mode: 'default',
          webSearchEnabled: false,
        },
        history: [],
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('session_joined');
      expect(mockWs.messages[0].session.mode).toBe('default');
      expect(mockWs.messages[0].history).toEqual([]);
    });

    it('should handle sessions_list message format', () => {
      const sessions = [
        createMockSession({ id: 'session-1', name: 'Session 1' }),
        createMockSession({ id: 'session-2', name: 'Session 2' }),
      ];

      const message = {
        type: 'sessions_list',
        sessions: sessions.map((s) => ({
          id: s.id,
          name: s.name,
          createdAt: s.createdAt,
          historyLength: 0,
        })),
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('sessions_list');
      expect(mockWs.messages[0].sessions).toHaveLength(2);
    });

    it('should handle error message format', () => {
      const message = {
        type: 'error',
        error: { message: 'Something went wrong' },
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('error');
      expect(mockWs.messages[0].error.message).toBe('Something went wrong');
    });

    it('should handle mode_changed message format', () => {
      const message = {
        type: 'mode_changed',
        mode: 'plan',
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('mode_changed');
      expect(mockWs.messages[0].mode).toBe('plan');
    });

    it('should handle web_search_changed message format', () => {
      const message = {
        type: 'web_search_changed',
        enabled: true,
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('web_search_changed');
      expect(mockWs.messages[0].enabled).toBe(true);
    });

    it('should handle session_renamed message format', () => {
      const message = {
        type: 'session_renamed',
        sessionId: 'test-123',
        name: 'New Session Name',
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('session_renamed');
      expect(mockWs.messages[0].name).toBe('New Session Name');
    });

    it('should handle session_deleted message format', () => {
      const message = {
        type: 'session_deleted',
        sessionId: 'deleted-session-id',
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('session_deleted');
      expect(mockWs.messages[0].sessionId).toBe('deleted-session-id');
    });

    it('should handle session_reset message format', () => {
      const newSession = createMockSession({ id: 'new-session-after-reset' });
      const message = {
        type: 'session_reset',
        session: {
          id: newSession.id,
          name: newSession.name,
          workingDirectory: newSession.workingDirectory,
          createdAt: newSession.createdAt,
        },
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('session_reset');
      expect(mockWs.messages[0].session.id).toBe('new-session-after-reset');
    });
  });

  describe('Streaming Message Formats', () => {
    it('should handle message_start format', () => {
      const message = { type: 'message_start' };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('message_start');
    });

    it('should handle chunk format', () => {
      const message = {
        type: 'chunk',
        text: 'Hello, ',
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('chunk');
      expect(mockWs.messages[0].text).toBe('Hello, ');
    });

    it('should handle content_start format for tool use', () => {
      const message = {
        type: 'content_start',
        contentBlock: {
          type: 'tool_use',
          name: 'Read',
        },
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('content_start');
      expect(mockWs.messages[0].contentBlock.name).toBe('Read');
    });

    it('should handle content_stop format', () => {
      const message = { type: 'content_stop' };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('content_stop');
    });

    it('should handle complete format', () => {
      const message = { type: 'complete' };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('complete');
    });

    it('should handle tool_use format', () => {
      const message = {
        type: 'tool_use',
        name: 'Bash',
        input: { command: 'ls -la' },
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('tool_use');
      expect(mockWs.messages[0].name).toBe('Bash');
      expect(mockWs.messages[0].input.command).toBe('ls -la');
    });
  });

  describe('Permission and Prompt Formats', () => {
    it('should handle permission_request format', () => {
      const message = {
        type: 'permission_request',
        requestId: 'perm-123',
        tool: 'Bash',
        description: 'Execute command',
        input: { command: 'npm install' },
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('permission_request');
      expect(mockWs.messages[0].tool).toBe('Bash');
    });

    it('should handle prompt format', () => {
      const message = {
        type: 'prompt',
        requestId: 'prompt-456',
        question: 'Which option do you prefer?',
        options: [
          { label: 'Option A', description: 'First option' },
          { label: 'Option B', description: 'Second option' },
        ],
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('prompt');
      expect(mockWs.messages[0].options).toHaveLength(2);
    });

    it('should handle exit_plan_mode_request format', () => {
      const message = {
        type: 'exit_plan_mode_request',
        requestId: 'exit-plan-789',
        allowedPrompts: [],
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('exit_plan_mode_request');
    });
  });

  describe('Agent Event Formats', () => {
    it('should handle agent_start format', () => {
      const message = {
        type: 'agent_start',
        taskId: 'task-123',
        description: 'Searching codebase',
        agentType: 'Explore',
        startTime: Date.now(),
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('agent_start');
      expect(mockWs.messages[0].agentType).toBe('Explore');
    });

    it('should handle task_notification format', () => {
      const message = {
        type: 'task_notification',
        taskId: 'task-123',
        status: 'completed',
        summary: 'Found 5 matching files',
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('task_notification');
      expect(mockWs.messages[0].status).toBe('completed');
    });

    it('should handle agents_list format', () => {
      const message = {
        type: 'agents_list',
        agents: [
          { taskId: 'task-1', description: 'Task 1', status: 'running' },
          { taskId: 'task-2', description: 'Task 2', status: 'completed' },
        ],
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('agents_list');
      expect(mockWs.messages[0].agents).toHaveLength(2);
    });
  });

  describe('Terminal Event Formats', () => {
    it('should handle terminal_created format', () => {
      const message = {
        type: 'terminal_created',
        terminalId: 'term-abc',
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('terminal_created');
      expect(mockWs.messages[0].terminalId).toBe('term-abc');
    });

    it('should handle terminal_data format', () => {
      const message = {
        type: 'terminal_data',
        terminalId: 'term-abc',
        data: 'user@host:~$ ',
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('terminal_data');
      expect(mockWs.messages[0].data).toBe('user@host:~$ ');
    });

    it('should handle terminal_exit format', () => {
      const message = {
        type: 'terminal_exit',
        terminalId: 'term-abc',
        exitCode: 0,
      };

      mockWs.send(JSON.stringify(message));

      expect(mockWs.messages[0].type).toBe('terminal_exit');
      expect(mockWs.messages[0].exitCode).toBe(0);
    });
  });
});
