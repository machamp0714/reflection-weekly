import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileLogger, ExecutionContext, ExecutionSuccessResult, ExecutionErrorResult } from './file-logger.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('FileLogger', () => {
  let tempDir: string;
  let logFilePath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reflection-weekly-test-'));
    logFilePath = path.join(tempDir, 'test.log');
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('should create log directory if it does not exist', () => {
      const nestedPath = path.join(tempDir, 'nested', 'dir', 'test.log');
      new FileLogger({ logFilePath: nestedPath, logLevel: 'info' });

      expect(fs.existsSync(path.dirname(nestedPath))).toBe(true);
    });

    it('should accept different log levels', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'debug' });
      expect(logger).toBeDefined();
    });
  });

  describe('logExecutionStart', () => {
    it('should log execution start event', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'info' });
      const context: ExecutionContext = {
        executionId: 'exec-123',
        scheduledTime: new Date('2026-02-06T19:00:00+09:00'),
        triggerType: 'scheduled',
      };

      logger.logExecutionStart(context);

      // Wait a bit for async write
      const logContent = fs.readFileSync(logFilePath, 'utf-8');
      expect(logContent).toContain('exec-123');
      expect(logContent).toContain('start');
    });

    it('should log manual trigger type', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'info' });
      const context: ExecutionContext = {
        executionId: 'exec-456',
        scheduledTime: new Date(),
        triggerType: 'manual',
      };

      logger.logExecutionStart(context);

      const logContent = fs.readFileSync(logFilePath, 'utf-8');
      expect(logContent).toContain('manual');
    });
  });

  describe('logExecutionSuccess', () => {
    it('should log successful execution with page URL', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'info' });
      const result: ExecutionSuccessResult = {
        executionId: 'exec-789',
        duration: 5000,
        pageUrl: 'https://notion.so/page/12345',
        summary: {
          prCount: 25,
          workHours: 40.5,
        },
      };

      logger.logExecutionSuccess(result);

      const logContent = fs.readFileSync(logFilePath, 'utf-8');
      expect(logContent).toContain('exec-789');
      expect(logContent).toContain('success');
      expect(logContent).toContain('https://notion.so/page/12345');
      expect(logContent).toContain('25');
    });
  });

  describe('logExecutionError', () => {
    it('should log error execution', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'info' });
      const errorResult: ExecutionErrorResult = {
        executionId: 'exec-error-1',
        duration: 3000,
        error: {
          type: 'NOTION_API_ERROR',
          message: 'Rate limit exceeded',
          stack: 'Error: Rate limit\n  at ...',
        },
      };

      logger.logExecutionError(errorResult);

      const logContent = fs.readFileSync(logFilePath, 'utf-8');
      expect(logContent).toContain('exec-error-1');
      expect(logContent).toContain('error');
      expect(logContent).toContain('Rate limit exceeded');
    });

    it('should log error with fallback local file path', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'info' });
      const errorResult: ExecutionErrorResult = {
        executionId: 'exec-error-2',
        duration: 2000,
        error: {
          type: 'NOTION_API_ERROR',
          message: 'Connection failed',
        },
        partialResult: {
          localFilePath: '/tmp/reflection-2026-02-06.md',
        },
      };

      logger.logExecutionError(errorResult);

      const logContent = fs.readFileSync(logFilePath, 'utf-8');
      expect(logContent).toContain('/tmp/reflection-2026-02-06.md');
    });
  });

  describe('maskSensitiveData', () => {
    it('should mask API tokens in error messages', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'info' });
      const errorResult: ExecutionErrorResult = {
        executionId: 'exec-error-3',
        duration: 1000,
        error: {
          type: 'AUTH_ERROR',
          message: 'Invalid token: ghp_1234567890abcdef1234567890abcdef12345678',
        },
      };

      logger.logExecutionError(errorResult);

      const logContent = fs.readFileSync(logFilePath, 'utf-8');
      // Should not contain the full token
      expect(logContent).not.toContain('ghp_1234567890abcdef1234567890abcdef12345678');
      // Should contain masked version
      expect(logContent).toContain('***');
    });

    it('should mask sk- prefixed keys', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'info' });
      const errorResult: ExecutionErrorResult = {
        executionId: 'exec-error-4',
        duration: 1000,
        error: {
          type: 'AUTH_ERROR',
          message: 'OpenAI error with key sk-proj-abc123xyz789',
        },
      };

      logger.logExecutionError(errorResult);

      const logContent = fs.readFileSync(logFilePath, 'utf-8');
      expect(logContent).not.toContain('sk-proj-abc123xyz789');
    });
  });

  describe('getRecentLogs', () => {
    it('should return recent log entries', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'info' });

      // Log multiple entries
      logger.logExecutionStart({
        executionId: 'exec-1',
        scheduledTime: new Date(),
        triggerType: 'manual',
      });
      logger.logExecutionSuccess({
        executionId: 'exec-1',
        duration: 1000,
        pageUrl: 'https://notion.so/1',
        summary: { prCount: 5, workHours: 10 },
      });
      logger.logExecutionStart({
        executionId: 'exec-2',
        scheduledTime: new Date(),
        triggerType: 'scheduled',
      });

      const logs = logger.getRecentLogs(3);

      expect(logs.length).toBe(3);
      expect(logs.some((l) => l.executionId === 'exec-1')).toBe(true);
      expect(logs.some((l) => l.executionId === 'exec-2')).toBe(true);
    });

    it('should limit the number of returned entries', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'info' });

      // Log multiple entries
      for (let i = 0; i < 10; i++) {
        logger.logExecutionStart({
          executionId: `exec-${i}`,
          scheduledTime: new Date(),
          triggerType: 'manual',
        });
      }

      const logs = logger.getRecentLogs(5);

      expect(logs.length).toBe(5);
    });
  });

  describe('log levels', () => {
    it('should not log debug messages when level is info', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'info' });

      logger.debug('exec-debug', { detail: 'debug info' });

      // File might not exist or be empty
      if (fs.existsSync(logFilePath)) {
        const logContent = fs.readFileSync(logFilePath, 'utf-8');
        expect(logContent).not.toContain('debug info');
      }
    });

    it('should log debug messages when level is debug', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'debug' });

      logger.debug('exec-debug', { detail: 'debug info' });

      const logContent = fs.readFileSync(logFilePath, 'utf-8');
      expect(logContent).toContain('debug info');
    });
  });

  describe('warnメソッド', () => {
    it('警告メッセージをログファイルに出力する', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'info' });

      logger.warn('exec-warn-1', 'API応答が遅延しています', { latency: 5000 });

      const logContent = fs.readFileSync(logFilePath, 'utf-8');
      expect(logContent).toContain('exec-warn-1');
      expect(logContent).toContain('API');
      expect(logContent).toContain('5000');
    });

    it('警告メッセージ内の機密情報をマスクする', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'info' });

      logger.warn('exec-warn-2', 'Token ghp_1234567890abcdef1234567890abcdef12345678 is invalid');

      const logContent = fs.readFileSync(logFilePath, 'utf-8');
      expect(logContent).not.toContain('ghp_1234567890abcdef1234567890abcdef12345678');
      expect(logContent).toContain('***');
    });
  });

  describe('getRecentLogs - エッジケース', () => {
    it('ログファイルが存在しない場合は空配列を返す', () => {
      const nonExistentPath = path.join(tempDir, 'non_existent.log');
      const logger = new FileLogger({ logFilePath: nonExistentPath, logLevel: 'info' });

      // ファイルが存在しないことを確認（constructorでは作成されないケースをシミュレート）
      if (fs.existsSync(nonExistentPath)) {
        fs.unlinkSync(nonExistentPath);
      }

      const logs = logger.getRecentLogs(10);
      expect(logs).toEqual([]);
    });

    it('limitが1の場合は最新の1件のみ返す', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'info' });

      logger.logExecutionStart({
        executionId: 'exec-a',
        scheduledTime: new Date(),
        triggerType: 'manual',
      });
      logger.logExecutionStart({
        executionId: 'exec-b',
        scheduledTime: new Date(),
        triggerType: 'scheduled',
      });

      const logs = logger.getRecentLogs(1);
      expect(logs.length).toBe(1);
      expect(logs[0].executionId).toBe('exec-b');
    });
  });

  describe('ログレベルフィルタリング', () => {
    it('warnレベルではinfoメッセージを出力しない', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'warn' });

      logger.logExecutionStart({
        executionId: 'exec-info',
        scheduledTime: new Date(),
        triggerType: 'manual',
      });

      // warnレベルではinfoメッセージは出力されない
      if (fs.existsSync(logFilePath)) {
        const logContent = fs.readFileSync(logFilePath, 'utf-8');
        expect(logContent).not.toContain('exec-info');
      }
    });

    it('errorレベルではerrorメッセージを出力する', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'error' });

      logger.logExecutionError({
        executionId: 'exec-err',
        duration: 1000,
        error: {
          type: 'TEST_ERROR',
          message: 'Test error message',
        },
      });

      const logContent = fs.readFileSync(logFilePath, 'utf-8');
      expect(logContent).toContain('exec-err');
      expect(logContent).toContain('Test error message');
    });
  });

  describe('機密情報マスキングパターン', () => {
    it('Notion secretトークンをマスクする', () => {
      const logger = new FileLogger({ logFilePath, logLevel: 'info' });

      logger.logExecutionError({
        executionId: 'exec-mask-1',
        duration: 1000,
        error: {
          type: 'AUTH_ERROR',
          message: 'Invalid token: secret_abcdefghij1234567890',
        },
      });

      const logContent = fs.readFileSync(logFilePath, 'utf-8');
      expect(logContent).not.toContain('secret_abcdefghij1234567890');
    });
  });
});
