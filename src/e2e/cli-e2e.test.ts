/**
 * エンドツーエンドテスト: Task 7.3
 *
 * CLIコマンドの全体的な動作をテストする:
 * - CLIコマンドの引数解析・実行テスト
 * - ドライランモードのプレビュー出力テスト
 * - スケジュール登録・解除コマンドの動作テスト
 *
 * 外部APIはモックを使用するが、CLI入力からユースケース出力までの
 * 完全なフローをテストする。
 *
 * Requirements: 8.1, 8.3, 8.4, 9.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ok, err } from '../types/result.js';
import type { Result } from '../types/result.js';
import type {
  ReflectionResult,
  ReflectionError,
  ReflectionOptions,
  ExecutionSummary,
} from '../application/reflection-use-case.js';
import type { DateRange } from '../domain/data-integrator.js';
import type {
  ScheduleRegistration,
  ScheduleStatus,
  ScheduleError,
  ScheduleRegisterOptions,
} from '../infrastructure/schedule/schedule-manager.js';
import {
  parseCLIOptions,
  buildDateRange,
  runCLI,
  formatSummary,
  formatError,
} from '../cli/cli.js';
import {
  ScheduleCommandHandler,
  type IScheduleManager,
} from '../presentation/schedule-command.js';

// --- テストヘルパー ---

/**
 * テスト用の日付範囲を生成する
 */
function createTestDateRange(): DateRange {
  return {
    start: new Date('2026-01-27T00:00:00Z'),
    end: new Date('2026-02-02T23:59:59Z'),
  };
}

/**
 * テスト用の実行サマリーを生成する
 */
function createTestSummary(overrides?: Partial<ExecutionSummary>): ExecutionSummary {
  return {
    dateRange: createTestDateRange(),
    prCount: 5,
    timeEntryCount: 12,
    totalWorkHours: 32.5,
    aiAnalysisEnabled: true,
    outputType: 'notion',
    ...overrides,
  };
}

/**
 * テスト用の振り返り結果を生成する
 */
function createTestReflectionResult(overrides?: Partial<ReflectionResult>): ReflectionResult {
  return {
    pageUrl: 'https://notion.so/test-page-123',
    summary: createTestSummary(),
    warnings: [],
    ...overrides,
  };
}

/**
 * モックのユースケース実行関数を作成する
 */
function createMockExecuteUseCase(
  returnValue: Result<ReflectionResult, ReflectionError>
): (options: ReflectionOptions) => Promise<Result<ReflectionResult, ReflectionError>> {
  return vi.fn().mockResolvedValue(returnValue);
}

/**
 * モックのScheduleManagerを作成する
 */
function createMockScheduleManager(overrides?: Partial<IScheduleManager>): IScheduleManager {
  return {
    register: vi.fn().mockResolvedValue(ok({
      cronExpression: '0 19 * * 0',
      nextExecution: new Date('2026-02-15T19:00:00+09:00'),
      platform: 'macos-launchd',
      configPath: '/tmp/test/schedule.json',
    } as ScheduleRegistration)),
    unregister: vi.fn().mockResolvedValue(ok(undefined)),
    getStatus: vi.fn().mockResolvedValue(ok({
      registered: false,
      platform: 'macos-launchd',
    } as ScheduleStatus)),
    validateCronExpression: vi.fn().mockReturnValue(ok(true)),
    getDefaultCronExpression: vi.fn().mockReturnValue('0 19 * * 0'),
    ...overrides,
  };
}

// =============================================================================
// E2Eテスト 1: CLIコマンドの引数解析・実行テスト (Requirement 8.1)
// =============================================================================

describe('E2E: CLIコマンドの引数解析・実行テスト', () => {
  describe('引数なしでのデフォルト実行', () => {
    it('引数なしで実行するとデフォルト設定でユースケースが呼ばれる', async () => {
      const mockExecute = createMockExecuteUseCase(ok(createTestReflectionResult()));

      const result = await runCLI([], mockExecute);

      // ユースケースが1回呼ばれる
      expect(mockExecute).toHaveBeenCalledTimes(1);

      // デフォルト設定が渡される
      const callArgs = (mockExecute as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReflectionOptions;
      expect(callArgs.dryRun).toBe(false);
      expect(callArgs.dateRange).toBeDefined();
      expect(callArgs.dateRange.start).toBeInstanceOf(Date);
      expect(callArgs.dateRange.end).toBeInstanceOf(Date);

      // 正常終了
      expect(result.success).toBe(true);
    });

    it('引数なし実行時のデフォルト期間は7日間である', async () => {
      const mockExecute = createMockExecuteUseCase(ok(createTestReflectionResult()));

      await runCLI([], mockExecute);

      const callArgs = (mockExecute as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReflectionOptions;
      const diffMs = callArgs.dateRange.end.getTime() - callArgs.dateRange.start.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      // おおよそ7日間の範囲であること
      expect(diffDays).toBeCloseTo(7, 0);
    });
  });

  describe('--start オプション (Requirement 8.3)', () => {
    it('--start オプションで開始日を指定できる', async () => {
      const mockExecute = createMockExecuteUseCase(ok(createTestReflectionResult()));

      await runCLI(['--start', '2026-01-27'], mockExecute);

      const callArgs = (mockExecute as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReflectionOptions;
      expect(callArgs.dateRange.start.toISOString()).toContain('2026-01-27');
    });

    it('-s 短縮形で開始日を指定できる', async () => {
      const mockExecute = createMockExecuteUseCase(ok(createTestReflectionResult()));

      await runCLI(['-s', '2026-01-27'], mockExecute);

      const callArgs = (mockExecute as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReflectionOptions;
      expect(callArgs.dateRange.start.toISOString()).toContain('2026-01-27');
    });
  });

  describe('--end オプション (Requirement 8.3)', () => {
    it('--end オプションで終了日を指定できる', async () => {
      const mockExecute = createMockExecuteUseCase(ok(createTestReflectionResult()));

      await runCLI(['--end', '2026-02-02'], mockExecute);

      const callArgs = (mockExecute as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReflectionOptions;
      expect(callArgs.dateRange.end.toISOString()).toContain('2026-02-02');
    });

    it('-e 短縮形で終了日を指定できる', async () => {
      const mockExecute = createMockExecuteUseCase(ok(createTestReflectionResult()));

      await runCLI(['-e', '2026-02-02'], mockExecute);

      const callArgs = (mockExecute as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReflectionOptions;
      expect(callArgs.dateRange.end.toISOString()).toContain('2026-02-02');
    });
  });

  describe('--start と --end の同時指定 (Requirement 8.3)', () => {
    it('期間指定オプションで開始日と終了日を同時に指定できる', async () => {
      const mockExecute = createMockExecuteUseCase(ok(createTestReflectionResult()));

      await runCLI(['--start', '2026-01-27', '--end', '2026-02-02'], mockExecute);

      const callArgs = (mockExecute as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReflectionOptions;
      expect(callArgs.dateRange.start.toISOString()).toContain('2026-01-27');
      expect(callArgs.dateRange.end.toISOString()).toContain('2026-02-02');
    });

    it('短縮形オプションの組み合わせで期間を指定できる', async () => {
      const mockExecute = createMockExecuteUseCase(ok(createTestReflectionResult()));

      await runCLI(['-s', '2026-01-27', '-e', '2026-02-02'], mockExecute);

      const callArgs = (mockExecute as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReflectionOptions;
      expect(callArgs.dateRange.start.toISOString()).toContain('2026-01-27');
      expect(callArgs.dateRange.end.toISOString()).toContain('2026-02-02');
    });
  });

  describe('--verbose オプション', () => {
    it('--verbose オプションで詳細出力モードが有効になる', async () => {
      const mockExecute = createMockExecuteUseCase(ok(createTestReflectionResult()));

      await runCLI(['--verbose'], mockExecute);

      // progressコールバックが渡される
      const callArgs = (mockExecute as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReflectionOptions;
      expect(callArgs.onProgress).toBeDefined();
      expect(typeof callArgs.onProgress).toBe('function');
    });

    it('-v 短縮形で詳細出力モードが有効になる', async () => {
      const mockExecute = createMockExecuteUseCase(ok(createTestReflectionResult()));

      await runCLI(['-v'], mockExecute);

      const callArgs = (mockExecute as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReflectionOptions;
      expect(callArgs.onProgress).toBeDefined();
    });
  });

  describe('全オプションの組み合わせ', () => {
    it('全てのオプションを組み合わせて使用できる', async () => {
      const mockExecute = createMockExecuteUseCase(
        ok(createTestReflectionResult({
          pageUrl: undefined,
          preview: '# Preview Content',
          summary: createTestSummary({ outputType: 'preview' }),
        }))
      );

      await runCLI([
        '--start', '2026-01-27',
        '--end', '2026-02-02',
        '--dry-run',
        '--verbose',
      ], mockExecute);

      const callArgs = (mockExecute as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReflectionOptions;
      expect(callArgs.dateRange.start.toISOString()).toContain('2026-01-27');
      expect(callArgs.dateRange.end.toISOString()).toContain('2026-02-02');
      expect(callArgs.dryRun).toBe(true);
      expect(callArgs.onProgress).toBeDefined();
    });

    it('短縮形の全オプションを組み合わせて使用できる', async () => {
      const mockExecute = createMockExecuteUseCase(
        ok(createTestReflectionResult({
          pageUrl: undefined,
          preview: '# Preview',
          summary: createTestSummary({ outputType: 'preview' }),
        }))
      );

      await runCLI(['-s', '2026-01-27', '-e', '2026-02-02', '-d', '-v'], mockExecute);

      const callArgs = (mockExecute as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReflectionOptions;
      expect(callArgs.dryRun).toBe(true);
      expect(callArgs.dateRange.start.toISOString()).toContain('2026-01-27');
      expect(callArgs.dateRange.end.toISOString()).toContain('2026-02-02');
    });
  });

  describe('CLI実行結果の検証', () => {
    it('正常完了時にsuccess=trueとNotionページURLを返す', async () => {
      const mockExecute = createMockExecuteUseCase(ok(createTestReflectionResult()));

      const result = await runCLI([], mockExecute);

      expect(result.success).toBe(true);
      expect(result.pageUrl).toBe('https://notion.so/test-page-123');
    });

    it('正常完了時に実行サマリーを返す', async () => {
      const mockExecute = createMockExecuteUseCase(ok(createTestReflectionResult()));

      const result = await runCLI([], mockExecute);

      expect(result.summary).toBeDefined();
      expect(result.summary.prCount).toBe(5);
      expect(result.summary.timeEntryCount).toBe(12);
      expect(result.summary.totalWorkHours).toBe(32.5);
      expect(result.summary.aiAnalysisEnabled).toBe(true);
    });

    it('ユースケース失敗時にsuccess=falseを返す', async () => {
      const mockExecute = createMockExecuteUseCase(
        err({
          type: 'CONFIG_INVALID' as const,
          missingFields: ['GITHUB_TOKEN', 'NOTION_DATABASE_ID'],
        })
      );

      const result = await runCLI([], mockExecute);

      expect(result.success).toBe(false);
    });

    it('Markdownフォールバック時にlocalFilePathを返す', async () => {
      const mockExecute = createMockExecuteUseCase(
        ok(createTestReflectionResult({
          pageUrl: undefined,
          localFilePath: '/tmp/reflection-weekly/reflection-2026-01-27-2026-02-02.md',
          summary: createTestSummary({ outputType: 'markdown' }),
        }))
      );

      const result = await runCLI([], mockExecute);

      expect(result.success).toBe(true);
      expect(result.localFilePath).toBe('/tmp/reflection-weekly/reflection-2026-01-27-2026-02-02.md');
      expect(result.pageUrl).toBeUndefined();
    });

    it('警告がある場合にwarnings配列に含まれる', async () => {
      const mockExecute = createMockExecuteUseCase(
        ok(createTestReflectionResult({
          warnings: ['PRが見つかりませんでした', 'Togglデータが空です'],
        }))
      );

      const result = await runCLI([], mockExecute);

      expect(result.warnings).toHaveLength(2);
      expect(result.warnings).toContain('PRが見つかりませんでした');
      expect(result.warnings).toContain('Togglデータが空です');
    });
  });
});

// =============================================================================
// E2Eテスト 2: ドライランモードのプレビュー出力テスト (Requirement 8.4)
// =============================================================================

describe('E2E: ドライランモードのプレビュー出力テスト', () => {
  describe('--dry-run オプションの動作', () => {
    it('--dry-run オプションでdryRun=trueがユースケースに渡される', async () => {
      const mockExecute = createMockExecuteUseCase(
        ok(createTestReflectionResult({
          pageUrl: undefined,
          preview: '# Week 5: 2026-01-27 - 2026-02-02\n\nPreview content',
          summary: createTestSummary({ outputType: 'preview' }),
        }))
      );

      await runCLI(['--dry-run'], mockExecute);

      const callArgs = (mockExecute as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReflectionOptions;
      expect(callArgs.dryRun).toBe(true);
    });

    it('-d 短縮形でドライランモードが有効になる', async () => {
      const mockExecute = createMockExecuteUseCase(
        ok(createTestReflectionResult({
          pageUrl: undefined,
          preview: '# Preview',
          summary: createTestSummary({ outputType: 'preview' }),
        }))
      );

      await runCLI(['-d'], mockExecute);

      const callArgs = (mockExecute as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReflectionOptions;
      expect(callArgs.dryRun).toBe(true);
    });
  });

  describe('ドライラン時のプレビュー出力', () => {
    it('ドライラン結果にpreviewコンテンツが含まれる', async () => {
      const previewContent = '# Week 5: 2026-01-27 - 2026-02-02\n\n## GitHub PRサマリー\n- feat: ダッシュボード画面を実装';
      const mockExecute = createMockExecuteUseCase(
        ok(createTestReflectionResult({
          pageUrl: undefined,
          preview: previewContent,
          summary: createTestSummary({ outputType: 'preview' }),
        }))
      );

      const result = await runCLI(['--dry-run'], mockExecute);

      expect(result.success).toBe(true);
      expect(result.pageUrl).toBeUndefined();
    });

    it('ドライラン時のformatSummaryにプレビューモードが表示される', () => {
      const result = createTestReflectionResult({
        pageUrl: undefined,
        preview: '# Week 5: 2026-01-27 - 2026-02-02\n\nPreview content',
        summary: createTestSummary({ outputType: 'preview' }),
      });

      const output = formatSummary(result);

      // プレビュー/ドライランモードの表示を確認
      expect(output).toMatch(/ドライラン|プレビュー|preview|dry.?run/i);
    });

    it('ドライラン時のformatSummaryにプレビュー内容が含まれる', () => {
      const previewContent = '# Week 5: 2026-01-27 - 2026-02-02\n\nPreview content with PR data';
      const result = createTestReflectionResult({
        pageUrl: undefined,
        preview: previewContent,
        summary: createTestSummary({ outputType: 'preview' }),
      });

      const output = formatSummary(result);

      // プレビュー内容が出力に含まれる
      expect(output).toContain('Preview content with PR data');
    });

    it('ドライラン時のサマリーにデータ集計情報が含まれる', () => {
      const result = createTestReflectionResult({
        pageUrl: undefined,
        preview: '# Preview',
        summary: createTestSummary({
          outputType: 'preview',
          prCount: 3,
          timeEntryCount: 8,
          totalWorkHours: 20.5,
          aiAnalysisEnabled: true,
        }),
      });

      const output = formatSummary(result);

      expect(output).toContain('3');     // PR数
      expect(output).toContain('8');     // タイムエントリ数
      expect(output).toContain('20.5');  // 総作業時間
    });
  });

  describe('ドライランと期間指定の組み合わせ', () => {
    it('ドライランモードと期間指定を同時に使用できる', async () => {
      const mockExecute = createMockExecuteUseCase(
        ok(createTestReflectionResult({
          pageUrl: undefined,
          preview: '# Preview',
          summary: createTestSummary({ outputType: 'preview' }),
        }))
      );

      await runCLI(['--start', '2026-01-27', '--end', '2026-02-02', '--dry-run'], mockExecute);

      const callArgs = (mockExecute as ReturnType<typeof vi.fn>).mock.calls[0][0] as ReflectionOptions;
      expect(callArgs.dryRun).toBe(true);
      expect(callArgs.dateRange.start.toISOString()).toContain('2026-01-27');
      expect(callArgs.dateRange.end.toISOString()).toContain('2026-02-02');
    });
  });

  describe('ドライラン時のNotionページURL', () => {
    it('ドライラン時にNotionページURLが返されない', async () => {
      const mockExecute = createMockExecuteUseCase(
        ok(createTestReflectionResult({
          pageUrl: undefined,
          preview: '# Preview',
          summary: createTestSummary({ outputType: 'preview' }),
        }))
      );

      const result = await runCLI(['--dry-run'], mockExecute);

      expect(result.success).toBe(true);
      expect(result.pageUrl).toBeUndefined();
    });
  });
});

// =============================================================================
// E2Eテスト 3: スケジュール登録・解除コマンドの動作テスト (Requirement 9.5)
// =============================================================================

describe('E2E: スケジュール登録・解除コマンドの動作テスト', () => {
  let mockScheduleManager: IScheduleManager;
  let handler: ScheduleCommandHandler;

  beforeEach(() => {
    mockScheduleManager = createMockScheduleManager();
    handler = new ScheduleCommandHandler(mockScheduleManager);
  });

  describe('スケジュール登録コマンド (schedule register)', () => {
    it('デフォルトcron式でスケジュールを登録できる', async () => {
      const result = await handler.handleRegister({
        force: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.cronExpression).toBe('0 19 * * 0');
        expect(result.value.nextExecution).toBeInstanceOf(Date);
        expect(result.value.configPath).toBeDefined();
        expect(result.value.message).toContain('スケジュール');
      }

      // デフォルトcron式がScheduleManagerに渡される
      expect(mockScheduleManager.register).toHaveBeenCalledWith({
        cronExpression: '0 19 * * 0',
        force: false,
      });
    });

    it('カスタムcron式でスケジュールを登録できる', async () => {
      const customRegistration: ScheduleRegistration = {
        cronExpression: '0 20 * * 1',
        nextExecution: new Date('2026-02-16T20:00:00+09:00'),
        platform: 'macos-launchd',
        configPath: '/tmp/test/schedule.json',
      };
      (mockScheduleManager.register as ReturnType<typeof vi.fn>)
        .mockResolvedValue(ok(customRegistration));

      const result = await handler.handleRegister({
        cron: '0 20 * * 1',
        force: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.cronExpression).toBe('0 20 * * 1');
      }

      expect(mockScheduleManager.register).toHaveBeenCalledWith({
        cronExpression: '0 20 * * 1',
        force: false,
      });
    });

    it('--force オプションで既存スケジュールを上書きできる', async () => {
      const result = await handler.handleRegister({
        cron: '0 19 * * 0',
        force: true,
      });

      expect(result.success).toBe(true);
      expect(mockScheduleManager.register).toHaveBeenCalledWith({
        cronExpression: '0 19 * * 0',
        force: true,
      });
    });

    it('無効なcron式でエラーメッセージを返す', async () => {
      const scheduleError: ScheduleError = {
        type: 'INVALID_CRON_EXPRESSION',
        expression: 'invalid-cron',
        message: '無効なcron式です',
      };
      (mockScheduleManager.register as ReturnType<typeof vi.fn>)
        .mockResolvedValue(err(scheduleError));

      const result = await handler.handleRegister({
        cron: 'invalid-cron',
        force: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('invalid-cron');
        expect(result.error.message).toContain('cron');
      }
    });

    it('既にスケジュールが登録済みの場合エラーメッセージを返す（forceなし）', async () => {
      const scheduleError: ScheduleError = {
        type: 'ALREADY_REGISTERED',
        existingExpression: '0 19 * * 0',
      };
      (mockScheduleManager.register as ReturnType<typeof vi.fn>)
        .mockResolvedValue(err(scheduleError));

      const result = await handler.handleRegister({
        cron: '0 20 * * 1',
        force: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('0 19 * * 0');
        expect(result.error.message).toContain('--force');
      }
    });

    it('登録成功メッセージに次回実行日時が含まれる', async () => {
      const result = await handler.handleRegister({
        force: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        // メッセージに次回実行を示す文字列が含まれる
        expect(result.value.message).toMatch(/次回実行/);
      }
    });
  });

  describe('スケジュール解除コマンド (schedule unregister)', () => {
    it('登録済みスケジュールを解除できる', async () => {
      const result = await handler.handleUnregister();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.message).toContain('解除');
      }
      expect(mockScheduleManager.unregister).toHaveBeenCalledTimes(1);
    });

    it('未登録状態で解除するとエラーメッセージを返す', async () => {
      const scheduleError: ScheduleError = {
        type: 'NOT_REGISTERED',
      };
      (mockScheduleManager.unregister as ReturnType<typeof vi.fn>)
        .mockResolvedValue(err(scheduleError));

      const result = await handler.handleUnregister();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toBeDefined();
        expect(result.error.message.length).toBeGreaterThan(0);
      }
    });

    it('権限不足で解除に失敗した場合エラーメッセージを返す', async () => {
      const scheduleError: ScheduleError = {
        type: 'PERMISSION_DENIED',
        path: '/Library/LaunchAgents/com.reflection-weekly.schedule.plist',
      };
      (mockScheduleManager.unregister as ReturnType<typeof vi.fn>)
        .mockResolvedValue(err(scheduleError));

      const result = await handler.handleUnregister();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('権限');
      }
    });
  });

  describe('スケジュール状態確認コマンド (schedule status)', () => {
    it('未登録状態のステータスを表示できる', async () => {
      const result = await handler.handleStatus();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.registered).toBe(false);
        expect(result.value.message).toBeDefined();
      }
    });

    it('登録済み状態のステータスにcron式が含まれる', async () => {
      (mockScheduleManager.getStatus as ReturnType<typeof vi.fn>)
        .mockResolvedValue(ok({
          registered: true,
          cronExpression: '0 19 * * 0',
          nextExecution: new Date('2026-02-15T19:00:00+09:00'),
          platform: 'macos-launchd',
        } as ScheduleStatus));

      const result = await handler.handleStatus();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.registered).toBe(true);
        expect(result.value.cronExpression).toBe('0 19 * * 0');
        expect(result.value.message).toContain('0 19 * * 0');
      }
    });

    it('登録済み状態のステータスに次回実行日時が含まれる', async () => {
      const nextExecution = new Date('2026-02-15T19:00:00+09:00');
      (mockScheduleManager.getStatus as ReturnType<typeof vi.fn>)
        .mockResolvedValue(ok({
          registered: true,
          cronExpression: '0 19 * * 0',
          nextExecution,
          platform: 'macos-launchd',
        } as ScheduleStatus));

      const result = await handler.handleStatus();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.nextExecution).toEqual(nextExecution);
        expect(result.value.message).toContain('次回実行');
      }
    });

    it('前回の実行記録がある場合に含まれる', async () => {
      (mockScheduleManager.getStatus as ReturnType<typeof vi.fn>)
        .mockResolvedValue(ok({
          registered: true,
          cronExpression: '0 19 * * 0',
          nextExecution: new Date('2026-02-15T19:00:00+09:00'),
          platform: 'macos-launchd',
          lastExecution: {
            timestamp: new Date('2026-02-08T19:00:00+09:00'),
            success: true,
            pageUrl: 'https://notion.so/last-page',
            duration: 15000,
          },
        } as ScheduleStatus));

      const result = await handler.handleStatus();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.lastExecution).toBeDefined();
        expect(result.value.lastExecution?.success).toBe(true);
        expect(result.value.lastExecution?.pageUrl).toBe('https://notion.so/last-page');
      }
    });

    it('前回の実行が失敗していた場合にエラー情報が含まれる', async () => {
      (mockScheduleManager.getStatus as ReturnType<typeof vi.fn>)
        .mockResolvedValue(ok({
          registered: true,
          cronExpression: '0 19 * * 0',
          nextExecution: new Date('2026-02-15T19:00:00+09:00'),
          platform: 'macos-launchd',
          lastExecution: {
            timestamp: new Date('2026-02-08T19:00:00+09:00'),
            success: false,
            error: 'Notion API error',
            duration: 5000,
          },
        } as ScheduleStatus));

      const result = await handler.handleStatus();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.lastExecution).toBeDefined();
        expect(result.value.lastExecution?.success).toBe(false);
        expect(result.value.lastExecution?.error).toBe('Notion API error');
      }
    });
  });

  describe('スケジュール登録→ステータス確認→解除の一連のフロー', () => {
    it('登録→ステータス確認→解除の全フローが正常に動作する', async () => {
      // Step 1: スケジュール登録
      const registerResult = await handler.handleRegister({
        cron: '0 19 * * 0',
        force: false,
      });
      expect(registerResult.success).toBe(true);

      // Step 2: ステータス確認（登録済み状態をモック）
      (mockScheduleManager.getStatus as ReturnType<typeof vi.fn>)
        .mockResolvedValue(ok({
          registered: true,
          cronExpression: '0 19 * * 0',
          nextExecution: new Date('2026-02-15T19:00:00+09:00'),
          platform: 'macos-launchd',
        } as ScheduleStatus));

      const statusResult = await handler.handleStatus();
      expect(statusResult.success).toBe(true);
      if (statusResult.success) {
        expect(statusResult.value.registered).toBe(true);
        expect(statusResult.value.cronExpression).toBe('0 19 * * 0');
      }

      // Step 3: スケジュール解除
      const unregisterResult = await handler.handleUnregister();
      expect(unregisterResult.success).toBe(true);

      // Step 4: ステータス確認（解除後の未登録状態をモック）
      (mockScheduleManager.getStatus as ReturnType<typeof vi.fn>)
        .mockResolvedValue(ok({
          registered: false,
          platform: 'macos-launchd',
        } as ScheduleStatus));

      const afterUnregisterStatus = await handler.handleStatus();
      expect(afterUnregisterStatus.success).toBe(true);
      if (afterUnregisterStatus.success) {
        expect(afterUnregisterStatus.value.registered).toBe(false);
      }
    });
  });
});

// =============================================================================
// E2Eテスト 4: CLIサマリー出力の整形テスト (Requirement 8.5)
// =============================================================================

describe('E2E: CLIサマリー出力の整形テスト', () => {
  describe('正常完了時のサマリー出力', () => {
    it('サマリーに期間情報が含まれる', () => {
      const result = createTestReflectionResult();
      const output = formatSummary(result);

      expect(output).toContain('2026-01-27');
      expect(output).toContain('2026-02-02');
    });

    it('サマリーにPR数が含まれる', () => {
      const result = createTestReflectionResult();
      const output = formatSummary(result);

      expect(output).toContain('5');
    });

    it('サマリーにタイムエントリ数が含まれる', () => {
      const result = createTestReflectionResult();
      const output = formatSummary(result);

      expect(output).toContain('12');
    });

    it('サマリーに総作業時間が含まれる', () => {
      const result = createTestReflectionResult();
      const output = formatSummary(result);

      expect(output).toContain('32.5');
    });

    it('サマリーにAI分析状態が含まれる', () => {
      const result = createTestReflectionResult();
      const output = formatSummary(result);

      // AI分析有効を示す文字列
      expect(output).toMatch(/AI|有効/i);
    });

    it('NotionページURLがサマリーに含まれる', () => {
      const result = createTestReflectionResult();
      const output = formatSummary(result);

      expect(output).toContain('https://notion.so/test-page-123');
    });
  });

  describe('Markdownフォールバック時のサマリー出力', () => {
    it('ローカルファイルパスがサマリーに含まれる', () => {
      const result = createTestReflectionResult({
        pageUrl: undefined,
        localFilePath: '/tmp/reflection-weekly/reflection-2026-01-27-2026-02-02.md',
        summary: createTestSummary({ outputType: 'markdown' }),
      });

      const output = formatSummary(result);

      expect(output).toContain('/tmp/reflection-weekly/reflection-2026-01-27-2026-02-02.md');
    });
  });

  describe('警告ありのサマリー出力', () => {
    it('警告メッセージがサマリーに含まれる', () => {
      const result = createTestReflectionResult({
        warnings: ['GitHubデータの一部取得に失敗しました', 'Togglプロジェクト情報が不完全です'],
      });

      const output = formatSummary(result);

      expect(output).toContain('GitHubデータの一部取得に失敗しました');
      expect(output).toContain('Togglプロジェクト情報が不完全です');
    });
  });

  describe('エラー時の出力', () => {
    it('CONFIG_INVALIDエラーの整形出力に不足フィールドが含まれる', () => {
      const error: ReflectionError = {
        type: 'CONFIG_INVALID',
        missingFields: ['GITHUB_TOKEN', 'NOTION_DATABASE_ID'],
      };

      const output = formatError(error);

      expect(output).toContain('GITHUB_TOKEN');
      expect(output).toContain('NOTION_DATABASE_ID');
    });

    it('DATA_COLLECTION_FAILEDエラーの整形出力にソースとメッセージが含まれる', () => {
      const error: ReflectionError = {
        type: 'DATA_COLLECTION_FAILED',
        source: 'github',
        message: 'Connection timeout',
      };

      const output = formatError(error);

      expect(output).toContain('github');
      expect(output).toContain('Connection timeout');
    });

    it('PAGE_CREATION_FAILEDエラーの整形出力にメッセージが含まれる', () => {
      const error: ReflectionError = {
        type: 'PAGE_CREATION_FAILED',
        message: 'Notion API rate limited',
      };

      const output = formatError(error);

      expect(output).toContain('Notion API rate limited');
    });
  });
});

// =============================================================================
// E2Eテスト 5: 引数解析関数の直接テスト（エッジケース）
// =============================================================================

describe('E2E: parseCLIOptions引数解析のエッジケース', () => {
  it('空の引数配列でデフォルトオプションを返す', () => {
    const options = parseCLIOptions([]);

    expect(options.dryRun).toBe(false);
    expect(options.verbose).toBe(false);
    expect(options.startDate).toBeUndefined();
    expect(options.endDate).toBeUndefined();
  });

  it('オプションの順序に依存しない', () => {
    const options1 = parseCLIOptions(['--verbose', '--dry-run', '--start', '2026-01-27']);
    const options2 = parseCLIOptions(['--start', '2026-01-27', '--dry-run', '--verbose']);

    expect(options1.verbose).toBe(options2.verbose);
    expect(options1.dryRun).toBe(options2.dryRun);
    expect(options1.startDate).toBe(options2.startDate);
  });
});

// =============================================================================
// E2Eテスト 6: buildDateRange日付範囲構築のエッジケース
// =============================================================================

describe('E2E: buildDateRange日付範囲構築のエッジケース', () => {
  it('開始日だけ指定した場合、終了日は現在日時に近い', () => {
    const options = parseCLIOptions(['--start', '2026-01-27']);
    const range = buildDateRange(options, 7);

    expect(range.start.toISOString()).toContain('2026-01-27');

    const now = new Date();
    const diffMs = Math.abs(range.end.getTime() - now.getTime());
    expect(diffMs).toBeLessThan(60000); // 1分以内
  });

  it('終了日だけ指定した場合、開始日は終了日のN日前になる', () => {
    const options = parseCLIOptions(['--end', '2026-02-02']);
    const range = buildDateRange(options, 7);

    expect(range.end.toISOString()).toContain('2026-02-02');

    const expectedStart = new Date('2026-01-26');
    const diffMs = Math.abs(range.start.getTime() - expectedStart.getTime());
    expect(diffMs).toBeLessThan(24 * 60 * 60 * 1000); // 1日以内
  });

  it('カスタムデフォルト期間（14日）が適用される', () => {
    const options = parseCLIOptions([]);
    const range = buildDateRange(options, 14);

    const diffMs = range.end.getTime() - range.start.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(14, 0);
  });
});
