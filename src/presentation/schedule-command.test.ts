import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduleCommandHandler } from './schedule-command.js';
import { ok, err } from '../types/result.js';
import type { Result } from '../types/result.js';
import type {
  ScheduleRegistration,
  ScheduleStatus,
  ScheduleError,
} from '../infrastructure/schedule/schedule-manager.js';

/**
 * ScheduleManagerのモックインターフェース
 */
interface MockScheduleManager {
  register: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
  getStatus: ReturnType<typeof vi.fn>;
  validateCronExpression: ReturnType<typeof vi.fn>;
  getDefaultCronExpression: ReturnType<typeof vi.fn>;
}

describe('ScheduleCommandHandler', () => {
  let mockScheduleManager: MockScheduleManager;
  let handler: ScheduleCommandHandler;

  beforeEach(() => {
    mockScheduleManager = {
      register: vi.fn(),
      unregister: vi.fn(),
      getStatus: vi.fn(),
      validateCronExpression: vi.fn(),
      getDefaultCronExpression: vi.fn().mockReturnValue('0 19 * * 0'),
    };
    handler = new ScheduleCommandHandler(mockScheduleManager);
  });

  describe('handleRegister', () => {
    it('cron式を指定してスケジュール登録を実行できる', async () => {
      const registration: ScheduleRegistration = {
        cronExpression: '0 19 * * 0',
        nextExecution: new Date('2026-02-15T19:00:00+09:00'),
        platform: 'macos-launchd',
        configPath: '/tmp/test/schedule.json',
      };

      mockScheduleManager.register.mockResolvedValue(ok(registration));

      const result = await handler.handleRegister({
        cron: '0 19 * * 0',
        force: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.message).toContain('0 19 * * 0');
        expect(result.value.cronExpression).toBe('0 19 * * 0');
        expect(result.value.nextExecution).toBeInstanceOf(Date);
      }
    });

    it('cron式未指定時にデフォルトスケジュールを使用する', async () => {
      const registration: ScheduleRegistration = {
        cronExpression: '0 19 * * 0',
        nextExecution: new Date('2026-02-15T19:00:00+09:00'),
        platform: 'macos-launchd',
        configPath: '/tmp/test/schedule.json',
      };

      mockScheduleManager.register.mockResolvedValue(ok(registration));

      const result = await handler.handleRegister({
        force: false,
      });

      expect(result.success).toBe(true);
      expect(mockScheduleManager.register).toHaveBeenCalledWith({
        cronExpression: '0 19 * * 0',
        force: false,
      });
    });

    it('forceオプション付きで登録できる', async () => {
      const registration: ScheduleRegistration = {
        cronExpression: '0 20 * * 1',
        nextExecution: new Date('2026-02-16T20:00:00+09:00'),
        platform: 'macos-launchd',
        configPath: '/tmp/test/schedule.json',
      };

      mockScheduleManager.register.mockResolvedValue(ok(registration));

      const result = await handler.handleRegister({
        cron: '0 20 * * 1',
        force: true,
      });

      expect(result.success).toBe(true);
      expect(mockScheduleManager.register).toHaveBeenCalledWith({
        cronExpression: '0 20 * * 1',
        force: true,
      });
    });

    it('無効なcron式の場合エラーメッセージを返す', async () => {
      const scheduleError: ScheduleError = {
        type: 'INVALID_CRON_EXPRESSION',
        expression: 'invalid',
        message: '無効なcron式です',
      };

      mockScheduleManager.register.mockResolvedValue(err(scheduleError));

      const result = await handler.handleRegister({
        cron: 'invalid',
        force: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('invalid');
      }
    });

    it('既存スケジュールがある場合エラーメッセージを返す', async () => {
      const scheduleError: ScheduleError = {
        type: 'ALREADY_REGISTERED',
        existingExpression: '0 19 * * 0',
      };

      mockScheduleManager.register.mockResolvedValue(err(scheduleError));

      const result = await handler.handleRegister({
        cron: '0 20 * * 1',
        force: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('0 19 * * 0');
      }
    });
  });

  describe('handleUnregister', () => {
    it('スケジュール解除を実行できる', async () => {
      mockScheduleManager.unregister.mockResolvedValue(ok(undefined));

      const result = await handler.handleUnregister();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.message).toBeDefined();
      }
    });

    it('未登録の場合エラーメッセージを返す', async () => {
      const scheduleError: ScheduleError = {
        type: 'NOT_REGISTERED',
      };

      mockScheduleManager.unregister.mockResolvedValue(err(scheduleError));

      const result = await handler.handleUnregister();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBeDefined();
      }
    });
  });

  describe('handleStatus', () => {
    it('未登録状態のステータスを表示できる', async () => {
      const status: ScheduleStatus = {
        registered: false,
        platform: 'macos-launchd',
      };

      mockScheduleManager.getStatus.mockResolvedValue(ok(status));

      const result = await handler.handleStatus();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.registered).toBe(false);
        expect(result.value.message).toBeDefined();
      }
    });

    it('登録済み状態のステータスを表示できる', async () => {
      const status: ScheduleStatus = {
        registered: true,
        cronExpression: '0 19 * * 0',
        nextExecution: new Date('2026-02-15T19:00:00+09:00'),
        platform: 'macos-launchd',
      };

      mockScheduleManager.getStatus.mockResolvedValue(ok(status));

      const result = await handler.handleStatus();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.registered).toBe(true);
        expect(result.value.cronExpression).toBe('0 19 * * 0');
        expect(result.value.message).toContain('0 19 * * 0');
      }
    });

    it('前回の実行記録がある場合に表示できる', async () => {
      const status: ScheduleStatus = {
        registered: true,
        cronExpression: '0 19 * * 0',
        nextExecution: new Date('2026-02-15T19:00:00+09:00'),
        platform: 'macos-launchd',
        lastExecution: {
          timestamp: new Date('2026-02-08T19:00:00+09:00'),
          success: true,
          pageUrl: 'https://notion.so/page-123',
          duration: 15000,
        },
      };

      mockScheduleManager.getStatus.mockResolvedValue(ok(status));

      const result = await handler.handleStatus();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.lastExecution).toBeDefined();
        expect(result.value.lastExecution?.success).toBe(true);
      }
    });
  });
});
