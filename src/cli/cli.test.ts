import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';
import type {
  ReflectionResult,
  ReflectionError,
  ReflectionOptions,
  ExecutionSummary,
  ProgressCallback,
} from '../application/reflection-use-case.js';
import type { DateRange } from '../domain/data-integrator.js';

// --- CLIモジュール型定義 ---

/**
 * CLIオプション（コマンドライン引数解析結果）
 */
interface CLIOptions {
  readonly startDate?: string;
  readonly endDate?: string;
  readonly dryRun: boolean;
  readonly verbose: boolean;
}

/**
 * CLI実行結果
 */
interface CLIResult {
  readonly success: boolean;
  readonly pageUrl?: string;
  readonly localFilePath?: string;
  readonly summary: ExecutionSummary;
  readonly warnings: readonly string[];
}

// --- テストヘルパー ---

function createMockDateRange(): DateRange {
  return {
    start: new Date('2026-01-27T00:00:00Z'),
    end: new Date('2026-02-02T23:59:59Z'),
  };
}

function createMockSummary(overrides?: Partial<ExecutionSummary>): ExecutionSummary {
  return {
    dateRange: createMockDateRange(),
    prCount: 5,
    timeEntryCount: 12,
    totalWorkHours: 32.5,
    aiAnalysisEnabled: true,
    outputType: 'notion',
    ...overrides,
  };
}

function createMockReflectionResult(overrides?: Partial<ReflectionResult>): ReflectionResult {
  return {
    pageUrl: 'https://notion.so/page-123',
    summary: createMockSummary(),
    warnings: [],
    ...overrides,
  };
}

// --- テスト開始 ---

describe('CLI', () => {
  // CLIモジュールをテスト前にインポート
  let parseCLIOptions: (args: string[]) => CLIOptions;
  let buildDateRange: (options: CLIOptions, defaultPeriodDays: number) => DateRange;
  let formatSummary: (result: ReflectionResult) => string;
  let createProgressCallback: (verbose: boolean) => ProgressCallback;
  let runCLI: (
    args: string[],
    executeUseCase: (options: ReflectionOptions) => Promise<Result<ReflectionResult, ReflectionError>>
  ) => Promise<CLIResult>;

  beforeEach(async () => {
    const cliModule = await import('./cli.js');
    parseCLIOptions = cliModule.parseCLIOptions;
    buildDateRange = cliModule.buildDateRange;
    formatSummary = cliModule.formatSummary;
    createProgressCallback = cliModule.createProgressCallback;
    runCLI = cliModule.runCLI;
  });

  describe('parseCLIOptions - コマンドライン引数解析', () => {
    it('デフォルトオプションを返す（引数なし）', () => {
      const options = parseCLIOptions([]);

      expect(options.dryRun).toBe(false);
      expect(options.verbose).toBe(false);
      expect(options.startDate).toBeUndefined();
      expect(options.endDate).toBeUndefined();
    });

    it('開始日オプション（--start）を解析する', () => {
      const options = parseCLIOptions(['--start', '2026-01-27']);

      expect(options.startDate).toBe('2026-01-27');
    });

    it('終了日オプション（--end）を解析する', () => {
      const options = parseCLIOptions(['--end', '2026-02-02']);

      expect(options.endDate).toBe('2026-02-02');
    });

    it('開始日と終了日を同時に指定できる', () => {
      const options = parseCLIOptions(['--start', '2026-01-27', '--end', '2026-02-02']);

      expect(options.startDate).toBe('2026-01-27');
      expect(options.endDate).toBe('2026-02-02');
    });

    it('ドライランオプション（--dry-run）を解析する', () => {
      const options = parseCLIOptions(['--dry-run']);

      expect(options.dryRun).toBe(true);
    });

    it('verboseオプション（--verbose）を解析する', () => {
      const options = parseCLIOptions(['--verbose']);

      expect(options.verbose).toBe(true);
    });

    it('短縮形オプション（-s, -e, -d, -v）を解析する', () => {
      const options = parseCLIOptions(['-s', '2026-01-27', '-e', '2026-02-02', '-d', '-v']);

      expect(options.startDate).toBe('2026-01-27');
      expect(options.endDate).toBe('2026-02-02');
      expect(options.dryRun).toBe(true);
      expect(options.verbose).toBe(true);
    });

    it('全オプションを組み合わせて指定できる', () => {
      const options = parseCLIOptions([
        '--start', '2026-01-27',
        '--end', '2026-02-02',
        '--dry-run',
        '--verbose',
      ]);

      expect(options.startDate).toBe('2026-01-27');
      expect(options.endDate).toBe('2026-02-02');
      expect(options.dryRun).toBe(true);
      expect(options.verbose).toBe(true);
    });
  });

  describe('buildDateRange - 日付範囲の構築', () => {
    it('開始日と終了日が指定された場合、その範囲を使用する', () => {
      const options: CLIOptions = {
        startDate: '2026-01-27',
        endDate: '2026-02-02',
        dryRun: false,
        verbose: false,
      };

      const range = buildDateRange(options, 7);

      expect(range.start.toISOString()).toContain('2026-01-27');
      expect(range.end.toISOString()).toContain('2026-02-02');
    });

    it('日付が指定されない場合、デフォルト期間（過去N日間）を使用する', () => {
      const options: CLIOptions = {
        dryRun: false,
        verbose: false,
      };

      const range = buildDateRange(options, 7);

      // 終了日は今日、開始日は7日前であること
      const now = new Date();
      const diffMs = range.end.getTime() - range.start.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);

      expect(diffDays).toBeCloseTo(7, 0);
    });

    it('開始日のみ指定された場合、終了日は今日になる', () => {
      const options: CLIOptions = {
        startDate: '2026-01-27',
        dryRun: false,
        verbose: false,
      };

      const range = buildDateRange(options, 7);

      expect(range.start.toISOString()).toContain('2026-01-27');
      // 終了日は現在日付に近い
      const now = new Date();
      const diffMs = Math.abs(range.end.getTime() - now.getTime());
      expect(diffMs).toBeLessThan(60000); // 1分以内の差
    });

    it('終了日のみ指定された場合、開始日はデフォルト期間前になる', () => {
      const options: CLIOptions = {
        endDate: '2026-02-02',
        dryRun: false,
        verbose: false,
      };

      const range = buildDateRange(options, 7);

      expect(range.end.toISOString()).toContain('2026-02-02');
      // 開始日は終了日の7日前
      const expectedStart = new Date('2026-01-26');
      const diffMs = Math.abs(range.start.getTime() - expectedStart.getTime());
      expect(diffMs).toBeLessThan(24 * 60 * 60 * 1000); // 1日以内の差
    });
  });

  describe('formatSummary - 結果サマリーの整形出力', () => {
    it('正常完了時のサマリーにNotionページURLを含む', () => {
      const result = createMockReflectionResult();

      const output = formatSummary(result);

      expect(output).toContain('https://notion.so/page-123');
    });

    it('サマリーにPR数を含む', () => {
      const result = createMockReflectionResult();

      const output = formatSummary(result);

      expect(output).toContain('5');
    });

    it('サマリーに作業時間を含む', () => {
      const result = createMockReflectionResult();

      const output = formatSummary(result);

      expect(output).toContain('32.5');
    });

    it('サマリーにタイムエントリ数を含む', () => {
      const result = createMockReflectionResult();

      const output = formatSummary(result);

      expect(output).toContain('12');
    });

    it('サマリーに期間情報を含む', () => {
      const result = createMockReflectionResult();

      const output = formatSummary(result);

      expect(output).toContain('2026-01-27');
      expect(output).toContain('2026-02-02');
    });

    it('AI分析が有効な場合、その旨を表示する', () => {
      const result = createMockReflectionResult();

      const output = formatSummary(result);

      // AI分析有効を示す文字列が含まれる
      expect(output).toMatch(/AI|ai/i);
    });

    it('Markdownフォールバック時にローカルファイルパスを表示する', () => {
      const result = createMockReflectionResult({
        pageUrl: undefined,
        localFilePath: '/tmp/reflection-weekly/reflection-2026-01-27-2026-02-02.md',
        summary: createMockSummary({ outputType: 'markdown' }),
      });

      const output = formatSummary(result);

      expect(output).toContain('/tmp/reflection-weekly/reflection-2026-01-27-2026-02-02.md');
    });

    it('ドライランモード時にプレビューであることを示す', () => {
      const result = createMockReflectionResult({
        pageUrl: undefined,
        preview: '# Week 5\n\nPreview content',
        summary: createMockSummary({ outputType: 'preview' }),
      });

      const output = formatSummary(result);

      // プレビューモードを示す文字列
      expect(output).toMatch(/preview|プレビュー|ドライラン|dry.?run/i);
    });

    it('警告がある場合、それらを表示する', () => {
      const result = createMockReflectionResult({
        warnings: ['PRが見つかりませんでした', 'Togglデータが空です'],
      });

      const output = formatSummary(result);

      expect(output).toContain('PRが見つかりませんでした');
      expect(output).toContain('Togglデータが空です');
    });
  });

  describe('createProgressCallback - 進捗表示コールバック', () => {
    it('コールバック関数を返す', () => {
      const callback = createProgressCallback(false);

      expect(typeof callback).toBe('function');
    });

    it('verboseモードのコールバック関数を返す', () => {
      const callback = createProgressCallback(true);

      expect(typeof callback).toBe('function');
    });

    it('コールバックがProgressEventを受け取れる', () => {
      const callback = createProgressCallback(false);

      // エラーなく呼び出せることを確認
      expect(() => {
        callback({ stage: 'config', status: 'start' });
        callback({ stage: 'data-collection', status: 'complete' });
        callback({ stage: 'analysis', status: 'error', message: 'AI unavailable' });
        callback({ stage: 'page-creation', status: 'complete' });
      }).not.toThrow();
    });
  });

  describe('runCLI - CLI実行統合', () => {
    it('正常実行時にsuccess=trueを返す', async () => {
      const mockExecute = vi.fn().mockResolvedValue(ok(createMockReflectionResult()));

      const result = await runCLI([], mockExecute);

      expect(result.success).toBe(true);
    });

    it('正常実行時にNotionページURLを返す', async () => {
      const mockExecute = vi.fn().mockResolvedValue(ok(createMockReflectionResult()));

      const result = await runCLI([], mockExecute);

      expect(result.pageUrl).toBe('https://notion.so/page-123');
    });

    it('ドライランオプション指定時にdryRun=trueでユースケースを実行する', async () => {
      const mockExecute = vi.fn().mockResolvedValue(
        ok(createMockReflectionResult({
          pageUrl: undefined,
          preview: '# Preview',
          summary: createMockSummary({ outputType: 'preview' }),
        }))
      );

      await runCLI(['--dry-run'], mockExecute);

      expect(mockExecute).toHaveBeenCalledWith(
        expect.objectContaining({ dryRun: true })
      );
    });

    it('期間指定オプションでdateRangeをユースケースに渡す', async () => {
      const mockExecute = vi.fn().mockResolvedValue(ok(createMockReflectionResult()));

      await runCLI(['--start', '2026-01-27', '--end', '2026-02-02'], mockExecute);

      const callArgs = mockExecute.mock.calls[0][0] as ReflectionOptions;
      expect(callArgs.dateRange.start.toISOString()).toContain('2026-01-27');
      expect(callArgs.dateRange.end.toISOString()).toContain('2026-02-02');
    });

    it('ユースケース失敗時にsuccess=falseを返す', async () => {
      const mockExecute = vi.fn().mockResolvedValue(
        err({
          type: 'CONFIG_INVALID' as const,
          missingFields: ['GITHUB_TOKEN'],
        })
      );

      const result = await runCLI([], mockExecute);

      expect(result.success).toBe(false);
    });

    it('実行結果にサマリー情報を含む', async () => {
      const mockExecute = vi.fn().mockResolvedValue(ok(createMockReflectionResult()));

      const result = await runCLI([], mockExecute);

      expect(result.summary).toBeDefined();
      expect(result.summary.prCount).toBe(5);
      expect(result.summary.timeEntryCount).toBe(12);
    });

    it('実行結果に警告を含む', async () => {
      const mockExecute = vi.fn().mockResolvedValue(
        ok(createMockReflectionResult({
          warnings: ['Warning 1'],
        }))
      );

      const result = await runCLI([], mockExecute);

      expect(result.warnings).toContain('Warning 1');
    });

    it('Markdownフォールバック時にlocalFilePathを返す', async () => {
      const mockExecute = vi.fn().mockResolvedValue(
        ok(createMockReflectionResult({
          pageUrl: undefined,
          localFilePath: '/tmp/fallback.md',
          summary: createMockSummary({ outputType: 'markdown' }),
        }))
      );

      const result = await runCLI([], mockExecute);

      expect(result.localFilePath).toBe('/tmp/fallback.md');
    });

    it('progressCallbackをユースケースに渡す', async () => {
      const mockExecute = vi.fn().mockResolvedValue(ok(createMockReflectionResult()));

      await runCLI([], mockExecute);

      const callArgs = mockExecute.mock.calls[0][0] as ReflectionOptions;
      expect(callArgs.onProgress).toBeDefined();
      expect(typeof callArgs.onProgress).toBe('function');
    });
  });
});
