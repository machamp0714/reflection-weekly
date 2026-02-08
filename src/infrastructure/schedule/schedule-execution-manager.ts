import type {
  ExecutionContext,
  ExecutionSuccessResult,
  ExecutionErrorResult,
  LogEntry,
} from '../logger/file-logger.js';
import type {
  ReflectionResult,
  ReflectionError,
  ReflectionOptions,
} from '../../application/reflection-use-case.js';
import type { DateRange } from '../../domain/data-integrator.js';
import type { Result } from '../../types/result.js';

// --- インターフェース ---

/**
 * スケジュール実行管理が利用するFileLoggerインターフェース
 */
export interface IFileLoggerForSchedule {
  logExecutionStart(context: ExecutionContext): void;
  logExecutionSuccess(result: ExecutionSuccessResult): void;
  logExecutionError(result: ExecutionErrorResult): void;
  warn(executionId: string, message: string, details?: Record<string, unknown>): void;
  getRecentLogs(limit: number): readonly LogEntry[];
}

/**
 * スケジュール実行管理が利用するReflectionUseCaseインターフェース
 */
export interface IReflectionUseCaseForSchedule {
  execute(options: ReflectionOptions): Promise<Result<ReflectionResult, ReflectionError>>;
}

/**
 * 失敗通知の送信インターフェース
 */
export interface INotificationSender {
  sendFailureNotification(
    url: string,
    notification: FailureNotification,
  ): Promise<void>;
}

/**
 * 失敗通知のペイロード
 */
export interface FailureNotification {
  readonly executionId: string;
  readonly error: {
    readonly type: string;
    readonly message: string;
  };
  readonly timestamp: Date;
}

/**
 * スケジュール実行オプション
 */
export interface ScheduleExecutionOptions {
  readonly dateRange: DateRange;
  readonly notificationUrl?: string;
}

/**
 * 実行履歴エントリ
 */
export interface ExecutionHistoryEntry {
  readonly executionId: string;
  readonly timestamp: Date;
  readonly success: boolean;
  readonly pageUrl?: string;
  readonly error?: string;
  readonly duration: number;
}

/**
 * ScheduleExecutionManagerの設定オプション
 */
export interface ScheduleExecutionManagerOptions {
  readonly maxHistorySize?: number;
}

/**
 * スケジュール実行管理
 *
 * スケジュール実行時のログ出力、エラーログ記録、
 * 失敗通知、NotionページURL記録、実行履歴追跡を管理する。
 *
 * Requirements: 9.3, 9.4, 9.6
 */
export class ScheduleExecutionManager {
  private readonly executionHistory: ExecutionHistoryEntry[] = [];
  private readonly maxHistorySize: number;

  constructor(
    private readonly logger: IFileLoggerForSchedule,
    private readonly useCase: IReflectionUseCaseForSchedule,
    private readonly notificationSender: INotificationSender,
    options?: ScheduleExecutionManagerOptions,
  ) {
    this.maxHistorySize = options?.maxHistorySize ?? 50;
  }

  /**
   * スケジュール振り返り生成を実行する
   *
   * 以下を行う:
   * 1. 実行開始ログを出力
   * 2. ReflectionUseCaseを実行
   * 3. 成功時: 成功ログ（NotionページURL含む）を出力
   * 4. 失敗時: エラーログを出力、オプション通知を送信
   * 5. 実行履歴に記録
   */
  async executeScheduledReflection(
    options: ScheduleExecutionOptions,
  ): Promise<ExecutionHistoryEntry> {
    const executionId = this.generateExecutionId();
    const startTime = Date.now();

    // 実行開始ログを出力
    this.logger.logExecutionStart({
      executionId,
      scheduledTime: new Date(),
      triggerType: 'scheduled',
    });

    try {
      // ReflectionUseCaseを実行
      const reflectionOptions: ReflectionOptions = {
        dateRange: options.dateRange,
        dryRun: false,
      };

      const result = await this.useCase.execute(reflectionOptions);
      const duration = Date.now() - startTime;

      if (result.success) {
        // 成功時の処理
        return this.handleSuccess(executionId, duration, result.value);
      } else {
        // 失敗時の処理
        return await this.handleFailure(executionId, duration, result.error, options);
      }
    } catch (error: unknown) {
      // 予期しない例外の処理
      const duration = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      return await this.handleUnexpectedError(
        executionId,
        duration,
        errorMessage,
        errorStack,
        options,
      );
    }
  }

  /**
   * 実行履歴を取得する
   */
  getExecutionHistory(): readonly ExecutionHistoryEntry[] {
    return [...this.executionHistory];
  }

  /**
   * 最新の実行記録を取得する
   */
  getLastExecutionRecord(): ExecutionHistoryEntry | undefined {
    if (this.executionHistory.length === 0) {
      return undefined;
    }
    return this.executionHistory[this.executionHistory.length - 1];
  }

  // --- プライベートメソッド ---

  /**
   * 成功時の処理
   */
  private handleSuccess(
    executionId: string,
    duration: number,
    result: ReflectionResult,
  ): ExecutionHistoryEntry {
    // NotionページURLまたはローカルファイルパスを記録
    const pageUrl = result.pageUrl ?? result.localFilePath;

    this.logger.logExecutionSuccess({
      executionId,
      duration,
      pageUrl: pageUrl ?? '',
      summary: {
        prCount: result.summary.prCount,
        workHours: result.summary.totalWorkHours,
      },
    });

    const entry: ExecutionHistoryEntry = {
      executionId,
      timestamp: new Date(),
      success: true,
      pageUrl,
      duration,
    };

    this.addToHistory(entry);
    return entry;
  }

  /**
   * ReflectionError失敗時の処理
   */
  private async handleFailure(
    executionId: string,
    duration: number,
    error: ReflectionError,
    options: ScheduleExecutionOptions,
  ): Promise<ExecutionHistoryEntry> {
    const errorMessage = this.formatReflectionError(error);

    this.logger.logExecutionError({
      executionId,
      duration,
      error: {
        type: error.type,
        message: errorMessage,
      },
    });

    // オプションの通知先への失敗通知
    if (options.notificationUrl) {
      await this.sendNotificationSafely(executionId, options.notificationUrl, {
        type: error.type,
        message: errorMessage,
      });
    }

    const entry: ExecutionHistoryEntry = {
      executionId,
      timestamp: new Date(),
      success: false,
      error: errorMessage,
      duration,
    };

    this.addToHistory(entry);
    return entry;
  }

  /**
   * 予期しない例外の処理
   */
  private async handleUnexpectedError(
    executionId: string,
    duration: number,
    errorMessage: string,
    errorStack: string | undefined,
    options: ScheduleExecutionOptions,
  ): Promise<ExecutionHistoryEntry> {
    this.logger.logExecutionError({
      executionId,
      duration,
      error: {
        type: 'UNEXPECTED_ERROR',
        message: errorMessage,
        stack: errorStack,
      },
    });

    // オプションの通知先への失敗通知
    if (options.notificationUrl) {
      await this.sendNotificationSafely(executionId, options.notificationUrl, {
        type: 'UNEXPECTED_ERROR',
        message: errorMessage,
      });
    }

    const entry: ExecutionHistoryEntry = {
      executionId,
      timestamp: new Date(),
      success: false,
      error: errorMessage,
      duration,
    };

    this.addToHistory(entry);
    return entry;
  }

  /**
   * 通知を安全に送信する（送信失敗時は警告ログのみ）
   */
  private async sendNotificationSafely(
    executionId: string,
    notificationUrl: string,
    error: { type: string; message: string },
  ): Promise<void> {
    try {
      await this.notificationSender.sendFailureNotification(notificationUrl, {
        executionId,
        error,
        timestamp: new Date(),
      });
    } catch (notifError: unknown) {
      const notifMessage = notifError instanceof Error ? notifError.message : String(notifError);
      this.logger.warn(executionId, `通知の送信に失敗しました: ${notifMessage}`, {
        notificationUrl,
      });
    }
  }

  /**
   * 実行履歴に追加（最大件数制御）
   */
  private addToHistory(entry: ExecutionHistoryEntry): void {
    this.executionHistory.push(entry);

    // 最大件数を超えた場合、古い履歴を削除
    while (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory.shift();
    }
  }

  /**
   * ReflectionErrorをメッセージ文字列に変換
   */
  private formatReflectionError(error: ReflectionError): string {
    switch (error.type) {
      case 'CONFIG_INVALID':
        return `設定が不正です。不足フィールド: ${error.missingFields.join(', ')}`;
      case 'DATA_COLLECTION_FAILED':
        return `データ収集に失敗しました (${error.source}): ${error.message}`;
      case 'PAGE_CREATION_FAILED':
        return `ページ作成に失敗しました: ${error.message}`;
    }
  }

  /**
   * ユニークな実行IDを生成
   */
  private generateExecutionId(): string {
    return `sched-${Date.now()}`;
  }
}
