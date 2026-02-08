import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ok, err } from '../../types/result.js';
import {
  ScheduleExecutionManager,
  type IFileLoggerForSchedule,
  type IReflectionUseCaseForSchedule,
  type INotificationSender,
  type ExecutionHistoryEntry,
  type ScheduleExecutionOptions,
} from './schedule-execution-manager.js';
import type { ReflectionResult, ReflectionError } from '../../application/reflection-use-case.js';

// --- テストヘルパー ---

function createMockFileLogger(): IFileLoggerForSchedule {
  return {
    logExecutionStart: vi.fn(),
    logExecutionSuccess: vi.fn(),
    logExecutionError: vi.fn(),
    warn: vi.fn(),
    getRecentLogs: vi.fn().mockReturnValue([]),
  };
}

function createMockReflectionUseCase(): IReflectionUseCaseForSchedule {
  return {
    execute: vi.fn().mockResolvedValue(
      ok({
        pageUrl: 'https://notion.so/page-123',
        summary: {
          dateRange: {
            start: new Date('2026-02-01T00:00:00Z'),
            end: new Date('2026-02-07T23:59:59Z'),
          },
          prCount: 5,
          timeEntryCount: 10,
          totalWorkHours: 32.5,
          aiAnalysisEnabled: true,
          outputType: 'notion' as const,
        },
        warnings: [],
      } satisfies ReflectionResult),
    ),
  };
}

function createMockNotificationSender(): INotificationSender {
  return {
    sendFailureNotification: vi.fn().mockResolvedValue(undefined),
  };
}

function createDefaultOptions(): ScheduleExecutionOptions {
  return {
    dateRange: {
      start: new Date('2026-02-01T00:00:00Z'),
      end: new Date('2026-02-07T23:59:59Z'),
    },
    notificationUrl: undefined,
  };
}

// --- テスト ---

describe('ScheduleExecutionManager', () => {
  let manager: ScheduleExecutionManager;
  let logger: IFileLoggerForSchedule;
  let useCase: IReflectionUseCaseForSchedule;
  let notificationSender: INotificationSender;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-08T19:00:00+09:00'));

    logger = createMockFileLogger();
    useCase = createMockReflectionUseCase();
    notificationSender = createMockNotificationSender();
    manager = new ScheduleExecutionManager(logger, useCase, notificationSender);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('executeScheduledReflection - 実行ログファイル出力', () => {
    it('実行開始時にログを出力する', async () => {
      const options = createDefaultOptions();

      await manager.executeScheduledReflection(options);

      expect(logger.logExecutionStart).toHaveBeenCalledTimes(1);
      expect(logger.logExecutionStart).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: expect.any(String),
          scheduledTime: expect.any(Date),
          triggerType: 'scheduled',
        }),
      );
    });

    it('実行IDがユニークなフォーマットである', async () => {
      const options = createDefaultOptions();

      await manager.executeScheduledReflection(options);

      const callArgs = vi.mocked(logger.logExecutionStart).mock.calls[0][0];
      // 実行IDは "sched-" プレフィックスとタイムスタンプを含む
      expect(callArgs.executionId).toMatch(/^sched-\d+/);
    });

    it('成功時に成功ログを出力する', async () => {
      const options = createDefaultOptions();

      await manager.executeScheduledReflection(options);

      expect(logger.logExecutionSuccess).toHaveBeenCalledTimes(1);
      expect(logger.logExecutionSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: expect.any(String),
          duration: expect.any(Number),
          pageUrl: 'https://notion.so/page-123',
          summary: expect.objectContaining({
            prCount: expect.any(Number),
            workHours: expect.any(Number),
          }),
        }),
      );
    });

    it('実行開始と成功ログで同じ実行IDが使われる', async () => {
      const options = createDefaultOptions();

      await manager.executeScheduledReflection(options);

      const startCallArgs = vi.mocked(logger.logExecutionStart).mock.calls[0][0];
      const successCallArgs = vi.mocked(logger.logExecutionSuccess).mock.calls[0][0];
      expect(startCallArgs.executionId).toBe(successCallArgs.executionId);
    });
  });

  describe('executeScheduledReflection - 失敗時のエラーログ記録', () => {
    it('ユースケース失敗時にエラーログを出力する', async () => {
      vi.mocked(useCase.execute).mockResolvedValue(
        err({
          type: 'DATA_COLLECTION_FAILED',
          source: 'github',
          message: 'GitHub API error',
        } satisfies ReflectionError),
      );

      const options = createDefaultOptions();

      await manager.executeScheduledReflection(options);

      expect(logger.logExecutionError).toHaveBeenCalledTimes(1);
      expect(logger.logExecutionError).toHaveBeenCalledWith(
        expect.objectContaining({
          executionId: expect.any(String),
          duration: expect.any(Number),
          error: expect.objectContaining({
            type: 'DATA_COLLECTION_FAILED',
            message: expect.stringContaining('GitHub API error'),
          }),
        }),
      );
    });

    it('設定エラー時にエラーログを出力する', async () => {
      vi.mocked(useCase.execute).mockResolvedValue(
        err({
          type: 'CONFIG_INVALID',
          missingFields: ['GITHUB_TOKEN', 'NOTION_DATABASE_ID'],
        } satisfies ReflectionError),
      );

      const options = createDefaultOptions();

      await manager.executeScheduledReflection(options);

      expect(logger.logExecutionError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            type: 'CONFIG_INVALID',
            message: expect.stringContaining('GITHUB_TOKEN'),
          }),
        }),
      );
    });

    it('ページ作成エラー時にエラーログを出力する', async () => {
      vi.mocked(useCase.execute).mockResolvedValue(
        err({
          type: 'PAGE_CREATION_FAILED',
          message: 'Notion API unavailable',
        } satisfies ReflectionError),
      );

      const options = createDefaultOptions();

      await manager.executeScheduledReflection(options);

      expect(logger.logExecutionError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            type: 'PAGE_CREATION_FAILED',
            message: expect.stringContaining('Notion API unavailable'),
          }),
        }),
      );
    });

    it('ユースケースが例外をスローした場合にもエラーログを出力する', async () => {
      vi.mocked(useCase.execute).mockRejectedValue(new Error('Unexpected error'));

      const options = createDefaultOptions();

      await manager.executeScheduledReflection(options);

      expect(logger.logExecutionError).toHaveBeenCalledTimes(1);
      expect(logger.logExecutionError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            type: 'UNEXPECTED_ERROR',
            message: 'Unexpected error',
          }),
        }),
      );
    });

    it('実行開始とエラーログで同じ実行IDが使われる', async () => {
      vi.mocked(useCase.execute).mockResolvedValue(
        err({
          type: 'DATA_COLLECTION_FAILED',
          source: 'github',
          message: 'API error',
        } satisfies ReflectionError),
      );

      const options = createDefaultOptions();

      await manager.executeScheduledReflection(options);

      const startCallArgs = vi.mocked(logger.logExecutionStart).mock.calls[0][0];
      const errorCallArgs = vi.mocked(logger.logExecutionError).mock.calls[0][0];
      expect(startCallArgs.executionId).toBe(errorCallArgs.executionId);
    });
  });

  describe('executeScheduledReflection - 通知先への失敗通知', () => {
    it('通知URLが設定されている場合、失敗時に通知を送信する', async () => {
      vi.mocked(useCase.execute).mockResolvedValue(
        err({
          type: 'DATA_COLLECTION_FAILED',
          source: 'github',
          message: 'GitHub API error',
        } satisfies ReflectionError),
      );

      const options: ScheduleExecutionOptions = {
        ...createDefaultOptions(),
        notificationUrl: 'https://hooks.slack.com/services/xxx',
      };

      await manager.executeScheduledReflection(options);

      expect(notificationSender.sendFailureNotification).toHaveBeenCalledTimes(1);
      expect(notificationSender.sendFailureNotification).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/xxx',
        expect.objectContaining({
          executionId: expect.any(String),
          error: expect.objectContaining({
            type: 'DATA_COLLECTION_FAILED',
          }),
          timestamp: expect.any(Date),
        }),
      );
    });

    it('通知URLが未設定の場合、通知を送信しない', async () => {
      vi.mocked(useCase.execute).mockResolvedValue(
        err({
          type: 'DATA_COLLECTION_FAILED',
          source: 'github',
          message: 'API error',
        } satisfies ReflectionError),
      );

      const options: ScheduleExecutionOptions = {
        ...createDefaultOptions(),
        notificationUrl: undefined,
      };

      await manager.executeScheduledReflection(options);

      expect(notificationSender.sendFailureNotification).not.toHaveBeenCalled();
    });

    it('成功時には通知を送信しない', async () => {
      const options: ScheduleExecutionOptions = {
        ...createDefaultOptions(),
        notificationUrl: 'https://hooks.slack.com/services/xxx',
      };

      await manager.executeScheduledReflection(options);

      expect(notificationSender.sendFailureNotification).not.toHaveBeenCalled();
    });

    it('通知の送信失敗はエラーとして処理せず、警告ログを出力する', async () => {
      vi.mocked(useCase.execute).mockResolvedValue(
        err({
          type: 'DATA_COLLECTION_FAILED',
          source: 'github',
          message: 'API error',
        } satisfies ReflectionError),
      );
      vi.mocked(notificationSender.sendFailureNotification).mockRejectedValue(
        new Error('Notification failed'),
      );

      const options: ScheduleExecutionOptions = {
        ...createDefaultOptions(),
        notificationUrl: 'https://hooks.slack.com/services/xxx',
      };

      // 例外をスローしないことを確認
      await expect(manager.executeScheduledReflection(options)).resolves.not.toThrow();

      // 警告ログが出力されることを確認
      expect(logger.warn).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('通知の送信に失敗'),
        expect.anything(),
      );
    });
  });

  describe('executeScheduledReflection - NotionページURL記録', () => {
    it('成功時にNotionページURLがログに記録される', async () => {
      const options = createDefaultOptions();

      await manager.executeScheduledReflection(options);

      expect(logger.logExecutionSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          pageUrl: 'https://notion.so/page-123',
        }),
      );
    });

    it('Markdownフォールバック時にローカルファイルパスがログに記録される', async () => {
      vi.mocked(useCase.execute).mockResolvedValue(
        ok({
          pageUrl: undefined,
          localFilePath: '/tmp/reflection-weekly/reflection-2026-02-01-2026-02-07.md',
          summary: {
            dateRange: {
              start: new Date('2026-02-01T00:00:00Z'),
              end: new Date('2026-02-07T23:59:59Z'),
            },
            prCount: 5,
            timeEntryCount: 10,
            totalWorkHours: 32.5,
            aiAnalysisEnabled: true,
            outputType: 'markdown' as const,
          },
          warnings: ['Notionページの作成に失敗しました'],
        } satisfies ReflectionResult),
      );

      const options = createDefaultOptions();

      await manager.executeScheduledReflection(options);

      expect(logger.logExecutionSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          pageUrl: '/tmp/reflection-weekly/reflection-2026-02-01-2026-02-07.md',
        }),
      );
    });
  });

  describe('executeScheduledReflection - 実行結果の返却', () => {
    it('成功時にExecutionHistoryEntryを返す', async () => {
      const options = createDefaultOptions();

      const result = await manager.executeScheduledReflection(options);

      expect(result.success).toBe(true);
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.pageUrl).toBe('https://notion.so/page-123');
      expect(result.error).toBeUndefined();
    });

    it('失敗時にもExecutionHistoryEntryを返す', async () => {
      vi.mocked(useCase.execute).mockResolvedValue(
        err({
          type: 'DATA_COLLECTION_FAILED',
          source: 'github',
          message: 'API error',
        } satisfies ReflectionError),
      );

      const options = createDefaultOptions();

      const result = await manager.executeScheduledReflection(options);

      expect(result.success).toBe(false);
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeDefined();
      expect(result.pageUrl).toBeUndefined();
    });
  });

  describe('getExecutionHistory - 実行履歴の追跡', () => {
    it('初期状態では空の実行履歴を返す', () => {
      const history = manager.getExecutionHistory();

      expect(history).toEqual([]);
    });

    it('実行後に履歴が追加される', async () => {
      const options = createDefaultOptions();

      await manager.executeScheduledReflection(options);

      const history = manager.getExecutionHistory();

      expect(history.length).toBe(1);
      expect(history[0].success).toBe(true);
      expect(history[0].pageUrl).toBe('https://notion.so/page-123');
    });

    it('複数回の実行履歴が追跡される', async () => {
      const options = createDefaultOptions();

      // 1回目: 成功
      await manager.executeScheduledReflection(options);

      // 2回目: 失敗
      vi.mocked(useCase.execute).mockResolvedValue(
        err({
          type: 'DATA_COLLECTION_FAILED',
          source: 'github',
          message: 'API error',
        } satisfies ReflectionError),
      );

      await manager.executeScheduledReflection(options);

      const history = manager.getExecutionHistory();

      expect(history.length).toBe(2);
      expect(history[0].success).toBe(true);
      expect(history[1].success).toBe(false);
    });

    it('実行履歴のエントリに必要な情報が含まれる', async () => {
      const options = createDefaultOptions();

      await manager.executeScheduledReflection(options);

      const history = manager.getExecutionHistory();
      const entry = history[0];

      expect(entry).toEqual(
        expect.objectContaining({
          executionId: expect.any(String),
          timestamp: expect.any(Date),
          success: true,
          pageUrl: 'https://notion.so/page-123',
          duration: expect.any(Number),
        }),
      );
    });

    it('最大履歴件数を超えた場合、古い履歴が削除される', async () => {
      // maxHistorySize=50のデフォルト制限をテスト
      const managerWithLimit = new ScheduleExecutionManager(
        logger,
        useCase,
        notificationSender,
        { maxHistorySize: 3 },
      );

      const options = createDefaultOptions();

      // 4回実行（制限は3）
      for (let i = 0; i < 4; i++) {
        await managerWithLimit.executeScheduledReflection(options);
      }

      const history = managerWithLimit.getExecutionHistory();

      expect(history.length).toBe(3);
    });
  });

  describe('getLastExecutionRecord - 最新の実行記録', () => {
    it('実行記録がない場合はundefinedを返す', () => {
      const record = manager.getLastExecutionRecord();

      expect(record).toBeUndefined();
    });

    it('最新の実行記録を返す', async () => {
      const options = createDefaultOptions();

      await manager.executeScheduledReflection(options);

      const record = manager.getLastExecutionRecord();

      expect(record).toBeDefined();
      expect(record!.success).toBe(true);
      expect(record!.pageUrl).toBe('https://notion.so/page-123');
    });
  });

  describe('durationの計測', () => {
    it('実行時間がミリ秒で記録される', async () => {
      // ユースケースの実行に100ms掛かるようにモック
      vi.mocked(useCase.execute).mockImplementation(async () => {
        vi.advanceTimersByTime(100);
        return ok({
          pageUrl: 'https://notion.so/page-123',
          summary: {
            dateRange: {
              start: new Date('2026-02-01T00:00:00Z'),
              end: new Date('2026-02-07T23:59:59Z'),
            },
            prCount: 5,
            timeEntryCount: 10,
            totalWorkHours: 32.5,
            aiAnalysisEnabled: true,
            outputType: 'notion' as const,
          },
          warnings: [],
        } satisfies ReflectionResult);
      });

      const options = createDefaultOptions();

      const result = await manager.executeScheduledReflection(options);

      expect(result.duration).toBe(100);
    });
  });
});
