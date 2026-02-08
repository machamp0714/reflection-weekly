import { Result, ok, err } from '../types/result.js';
import type {
  ScheduleRegistration,
  ScheduleStatus,
  ScheduleError,
  ScheduleRegisterOptions,
  ExecutionRecord,
} from '../infrastructure/schedule/schedule-manager.js';

// --- 型定義 ---

/**
 * スケジュール登録コマンドのオプション
 */
export interface ScheduleRegisterCommandOptions {
  readonly cron?: string;
  readonly force: boolean;
}

/**
 * スケジュール登録成功時の結果
 */
export interface RegisterCommandResult {
  readonly message: string;
  readonly cronExpression: string;
  readonly nextExecution: Date;
  readonly configPath: string;
}

/**
 * スケジュール解除成功時の結果
 */
export interface UnregisterCommandResult {
  readonly message: string;
}

/**
 * スケジュールステータス表示結果
 */
export interface StatusCommandResult {
  readonly registered: boolean;
  readonly cronExpression?: string;
  readonly nextExecution?: Date;
  readonly lastExecution?: ExecutionRecord;
  readonly message: string;
}

/**
 * コマンドエラー
 */
export interface CommandError {
  readonly message: string;
}

/**
 * IScheduleManager - ScheduleManagerのインターフェース（依存性逆転）
 */
export interface IScheduleManager {
  register(options: ScheduleRegisterOptions): Promise<Result<ScheduleRegistration, ScheduleError>>;
  unregister(): Promise<Result<void, ScheduleError>>;
  getStatus(): Promise<Result<ScheduleStatus, ScheduleError>>;
  validateCronExpression(expression: string): Result<true, ScheduleError>;
  getDefaultCronExpression(): string;
}

/**
 * ScheduleCommandHandler - スケジュール管理CLIコマンドのハンドラー
 *
 * 主な責務:
 * - スケジュール登録サブコマンドの処理
 * - スケジュール解除サブコマンドの処理
 * - スケジュール状態確認の処理
 * - ユーザー向けメッセージの生成
 */
export class ScheduleCommandHandler {
  constructor(private readonly scheduleManager: IScheduleManager) {}

  /**
   * スケジュール登録コマンドを処理する
   */
  async handleRegister(
    options: ScheduleRegisterCommandOptions
  ): Promise<Result<RegisterCommandResult, CommandError>> {
    // cron式が未指定の場合はデフォルトを使用
    const cronExpression = options.cron || this.scheduleManager.getDefaultCronExpression();

    const result = await this.scheduleManager.register({
      cronExpression,
      force: options.force,
    });

    if (!result.success) {
      return err({
        message: this.formatScheduleError(result.error),
      });
    }

    const registration = result.value;
    return ok({
      message: `スケジュールを登録しました: ${registration.cronExpression} (次回実行: ${this.formatDate(registration.nextExecution)})`,
      cronExpression: registration.cronExpression,
      nextExecution: registration.nextExecution,
      configPath: registration.configPath,
    });
  }

  /**
   * スケジュール解除コマンドを処理する
   */
  async handleUnregister(): Promise<Result<UnregisterCommandResult, CommandError>> {
    const result = await this.scheduleManager.unregister();

    if (!result.success) {
      return err({
        message: this.formatScheduleError(result.error),
      });
    }

    return ok({
      message: 'スケジュールを解除しました',
    });
  }

  /**
   * スケジュール状態確認コマンドを処理する
   */
  async handleStatus(): Promise<Result<StatusCommandResult, CommandError>> {
    const result = await this.scheduleManager.getStatus();

    if (!result.success) {
      return err({
        message: 'スケジュール状態の取得に失敗しました',
      });
    }

    const status = result.value;

    if (!status.registered) {
      return ok({
        registered: false,
        message: 'スケジュールは登録されていません',
      });
    }

    let message = `スケジュール登録済み: ${status.cronExpression}`;
    if (status.nextExecution) {
      message += ` (次回実行: ${this.formatDate(status.nextExecution)})`;
    }

    return ok({
      registered: true,
      cronExpression: status.cronExpression,
      nextExecution: status.nextExecution,
      lastExecution: status.lastExecution,
      message,
    });
  }

  // --- プライベートメソッド ---

  /**
   * スケジュールエラーをユーザー向けメッセージに変換する
   */
  private formatScheduleError(error: ScheduleError): string {
    switch (error.type) {
      case 'INVALID_CRON_EXPRESSION':
        return `無効なcron式です: ${error.expression}。正しいcron式を指定してください（例: "0 19 * * 0"）`;
      case 'ALREADY_REGISTERED':
        return `既にスケジュールが登録されています: ${error.existingExpression}。上書きする場合は --force オプションを使用してください`;
      case 'NOT_REGISTERED':
        return 'スケジュールが登録されていません。先に "schedule register" コマンドで登録してください';
      case 'PLATFORM_NOT_SUPPORTED':
        return `プラットフォーム "${error.platform}" はサポートされていません。macOS (launchd) または Linux (systemd/cron) をご利用ください`;
      case 'PERMISSION_DENIED':
        return `権限が不足しています: ${error.path}。適切な権限で再実行してください`;
      case 'EXECUTION_FAILED':
        return `スケジュール実行に失敗しました: ${error.message}`;
    }
  }

  /**
   * 日時をフォーマットする
   */
  private formatDate(date: Date): string {
    return date.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Tokyo',
    });
  }
}
