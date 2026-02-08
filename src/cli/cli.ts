/**
 * CLI モジュール - コマンドライン引数解析と実行制御
 *
 * Commander.jsを使用したコマンドライン引数解析、
 * 進捗表示（スピナー）、結果サマリー整形出力を提供する。
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 4.6
 */

import { Command } from 'commander';
import type { Result } from '../types/result.js';
import type {
  ReflectionResult,
  ReflectionError,
  ReflectionOptions,
  ExecutionSummary,
  ProgressCallback,
  ProgressEvent,
} from '../application/reflection-use-case.js';
import type { DateRange } from '../domain/data-integrator.js';

// --- CLI型定義 ---

/**
 * CLIオプション（コマンドライン引数解析結果）
 */
export interface CLIOptions {
  readonly startDate?: string;
  readonly endDate?: string;
  readonly dryRun: boolean;
  readonly verbose: boolean;
}

/**
 * CLI実行結果
 */
export interface CLIResult {
  readonly success: boolean;
  readonly pageUrl?: string;
  readonly localFilePath?: string;
  readonly summary: ExecutionSummary;
  readonly warnings: readonly string[];
}

// --- コマンドライン引数解析 ---

/**
 * コマンドライン引数を解析してCLIOptionsを返す
 *
 * @param args - コマンドライン引数の配列
 * @returns 解析されたCLIオプション
 */
export function parseCLIOptions(args: string[]): CLIOptions {
  const program = new Command();

  program
    .name('reflection-weekly')
    .description('週次振り返りページを自動生成するCLIツール')
    .version('1.0.0')
    .option('-s, --start <date>', '開始日 (YYYY-MM-DD形式)')
    .option('-e, --end <date>', '終了日 (YYYY-MM-DD形式)')
    .option('-d, --dry-run', 'ドライラン（Notionページを作成せずプレビュー）', false)
    .option('-v, --verbose', '詳細出力モード', false)
    .exitOverride() // テスト時にprocess.exitを防止
    .configureOutput({
      writeOut: () => {}, // テスト時の標準出力を抑制
      writeErr: () => {}, // テスト時のエラー出力を抑制
    });

  program.parse(args, { from: 'user' });

  const opts = program.opts();

  return {
    startDate: opts.start as string | undefined,
    endDate: opts.end as string | undefined,
    dryRun: opts.dryRun as boolean,
    verbose: opts.verbose as boolean,
  };
}

// --- 日付範囲の構築 ---

/**
 * YYYY-MM-DD形式の日付文字列をUTCの00:00:00としてDateオブジェクトに変換する
 */
function parseDateAsUTC(dateStr: string): Date {
  // YYYY-MM-DD形式をUTCとして解釈する
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

/**
 * CLIオプションから日付範囲を構築する
 *
 * 日付文字列はUTCとして解釈される。
 * 指定がない場合はデフォルト期間（日数）を使用する。
 *
 * @param options - CLIオプション
 * @param defaultPeriodDays - デフォルトの期間（日数）
 * @returns 構築された日付範囲
 */
export function buildDateRange(options: CLIOptions, defaultPeriodDays: number): DateRange {
  const now = new Date();

  let end: Date;
  if (options.endDate) {
    end = parseDateAsUTC(options.endDate);
    // 終了日はその日の終わり(UTC)に設定
    end = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999));
  } else {
    end = now;
  }

  let start: Date;
  if (options.startDate) {
    start = parseDateAsUTC(options.startDate);
  } else {
    // デフォルト: 終了日からN日前
    start = new Date(end);
    start = new Date(Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate() - defaultPeriodDays,
      0, 0, 0, 0
    ));
  }

  return { start, end };
}

// --- 進捗表示 ---

/**
 * ステージ名の日本語マッピング
 */
const STAGE_LABELS: Record<string, string> = {
  config: '設定読み込み',
  'data-collection': 'データ収集',
  analysis: 'AI分析',
  'page-creation': 'ページ作成',
};

/**
 * 進捗表示用のコールバック関数を作成する
 *
 * スピナーを使用してリアルタイムの進捗を表示する。
 * verboseモードでは詳細なメッセージも出力する。
 *
 * @param verbose - 詳細出力モードの有効/無効
 * @returns ProgressCallback関数
 */
export function createProgressCallback(verbose: boolean): ProgressCallback {
  return (event: ProgressEvent) => {
    const label = STAGE_LABELS[event.stage] || event.stage;

    if (event.status === 'start') {
      // スピナー開始（実際のoraスピナーはrunCLI内で管理）
      if (verbose) {
        process.stdout.write(`[開始] ${label}...\n`);
      }
    } else if (event.status === 'complete') {
      if (verbose) {
        process.stdout.write(`[完了] ${label}\n`);
      }
    } else if (event.status === 'error') {
      if (verbose) {
        const msg = event.message ? `: ${event.message}` : '';
        process.stderr.write(`[エラー] ${label}${msg}\n`);
      }
    }
  };
}

// --- 結果サマリー整形 ---

/**
 * 実行結果を整形した文字列として返す
 *
 * @param result - 振り返り生成結果
 * @returns 整形されたサマリー文字列
 */
export function formatSummary(result: ReflectionResult): string {
  const { summary, warnings } = result;
  const lines: string[] = [];

  lines.push('');
  lines.push('========================================');
  lines.push('  振り返り生成結果サマリー');
  lines.push('========================================');
  lines.push('');

  // 期間情報
  const startStr = summary.dateRange.start.toISOString().split('T')[0];
  const endStr = summary.dateRange.end.toISOString().split('T')[0];
  lines.push(`  期間: ${startStr} - ${endStr}`);
  lines.push('');

  // データ集計
  lines.push('  --- データ集計 ---');
  lines.push(`  PR数: ${summary.prCount}`);
  lines.push(`  タイムエントリ数: ${summary.timeEntryCount}`);
  lines.push(`  総作業時間: ${summary.totalWorkHours}h`);
  lines.push(`  AI分析: ${summary.aiAnalysisEnabled ? '有効' : '無効'}`);
  lines.push('');

  // 出力先情報
  if (summary.outputType === 'preview') {
    lines.push('  --- 出力 ---');
    lines.push('  モード: ドライラン（プレビュー）');
    if (result.preview) {
      lines.push('');
      lines.push('  --- プレビュー内容 ---');
      lines.push(result.preview);
    }
  } else if (summary.outputType === 'notion') {
    lines.push('  --- 出力 ---');
    lines.push(`  Notionページ: ${result.pageUrl}`);
  } else if (summary.outputType === 'markdown') {
    lines.push('  --- 出力 ---');
    lines.push(`  ローカルファイル: ${result.localFilePath}`);
  }

  // 警告表示
  if (warnings.length > 0) {
    lines.push('');
    lines.push('  --- 警告 ---');
    for (const warning of warnings) {
      lines.push(`  ! ${warning}`);
    }
  }

  lines.push('');
  lines.push('========================================');

  return lines.join('\n');
}

// --- エラー整形 ---

/**
 * ReflectionErrorを整形した文字列として返す
 *
 * @param error - 振り返り生成エラー
 * @returns 整形されたエラーメッセージ
 */
export function formatError(error: ReflectionError): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('========================================');
  lines.push('  エラー');
  lines.push('========================================');
  lines.push('');

  switch (error.type) {
    case 'CONFIG_INVALID':
      lines.push('  設定に不備があります。以下の項目を確認してください:');
      for (const field of error.missingFields) {
        lines.push(`    - ${field}`);
      }
      break;
    case 'DATA_COLLECTION_FAILED':
      lines.push(`  データ収集に失敗しました (${error.source}): ${error.message}`);
      break;
    case 'PAGE_CREATION_FAILED':
      lines.push(`  ページ作成に失敗しました: ${error.message}`);
      break;
  }

  lines.push('');
  lines.push('========================================');

  return lines.join('\n');
}

// --- メインCLI実行 ---

/**
 * CLIのメイン実行関数
 *
 * コマンドライン引数を解析し、ユースケースを実行して結果を返す。
 * 進捗表示にはoraスピナーを使用する。
 *
 * @param args - コマンドライン引数
 * @param executeUseCase - ユースケース実行関数（DIにより注入）
 * @returns CLI実行結果
 */
export async function runCLI(
  args: string[],
  executeUseCase: (options: ReflectionOptions) => Promise<Result<ReflectionResult, ReflectionError>>
): Promise<CLIResult> {
  // 引数解析
  const cliOptions = parseCLIOptions(args);

  // 日付範囲の構築（デフォルト7日間）
  const dateRange = buildDateRange(cliOptions, 7);

  // 進捗コールバックの作成
  const onProgress = createProgressCallback(cliOptions.verbose);

  // ユースケース実行オプション
  const reflectionOptions: ReflectionOptions = {
    dateRange,
    dryRun: cliOptions.dryRun,
    onProgress,
  };

  // ユースケース実行
  const result = await executeUseCase(reflectionOptions);

  if (result.success) {
    const { value } = result;
    return {
      success: true,
      pageUrl: value.pageUrl,
      localFilePath: value.localFilePath,
      summary: value.summary,
      warnings: value.warnings,
    };
  } else {
    // エラー時のデフォルトサマリー
    const defaultSummary: ExecutionSummary = {
      dateRange,
      prCount: 0,
      timeEntryCount: 0,
      totalWorkHours: 0,
      aiAnalysisEnabled: false,
      outputType: 'notion',
    };

    return {
      success: false,
      summary: defaultSummary,
      warnings: [],
    };
  }
}
