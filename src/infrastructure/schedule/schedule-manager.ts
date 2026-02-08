import { Result, ok, err } from '../../types/result.js';
import type { ScheduleConfig } from '../config/config-manager.js';
import cron from 'node-cron';
import * as fs from 'fs';
import * as path from 'path';

// --- 型定義 ---

/**
 * スケジュール登録オプション
 */
export interface ScheduleRegisterOptions {
  readonly cronExpression: string;
  readonly force: boolean;
}

/**
 * スケジュール登録結果
 */
export interface ScheduleRegistration {
  readonly cronExpression: string;
  readonly nextExecution: Date;
  readonly platform: Platform;
  readonly configPath: string;
}

/**
 * サポート対象プラットフォーム
 */
export type Platform = 'macos-launchd' | 'linux-systemd' | 'linux-cron';

/**
 * スケジュール状態
 */
export interface ScheduleStatus {
  readonly registered: boolean;
  readonly cronExpression?: string;
  readonly nextExecution?: Date;
  readonly lastExecution?: ExecutionRecord;
  readonly platform: Platform;
}

/**
 * 実行記録
 */
export interface ExecutionRecord {
  readonly timestamp: Date;
  readonly success: boolean;
  readonly pageUrl?: string;
  readonly error?: string;
  readonly duration: number;
}

/**
 * スケジュールエラー型
 */
export type ScheduleError =
  | { readonly type: 'INVALID_CRON_EXPRESSION'; readonly expression: string; readonly message: string }
  | { readonly type: 'ALREADY_REGISTERED'; readonly existingExpression: string }
  | { readonly type: 'NOT_REGISTERED' }
  | { readonly type: 'PLATFORM_NOT_SUPPORTED'; readonly platform: string }
  | { readonly type: 'PERMISSION_DENIED'; readonly path: string }
  | { readonly type: 'EXECUTION_FAILED'; readonly message: string };

/**
 * プラットフォーム固有の設定ファイル情報
 */
export interface PlatformConfig {
  readonly platform: Platform;
  readonly configContent: string;
  readonly configPath: string;
  readonly installInstructions: readonly string[];
}

/**
 * 内部設定ファイルの構造
 */
interface ScheduleConfigFile {
  readonly cronExpression: string;
  readonly registered: boolean;
  readonly registeredAt: string;
  readonly lastExecution?: {
    readonly timestamp: string;
    readonly success: boolean;
    readonly pageUrl?: string;
    readonly error?: string;
    readonly duration: number;
  };
}

/**
 * ScheduleManager - 定期実行スケジュールの登録・解除・状態管理を担当
 *
 * 主な責務:
 * - cron互換スケジュール式のバリデーション
 * - スケジュールの登録・解除
 * - スケジュール状態の確認と永続化
 * - プラットフォーム検出
 */
export class ScheduleManager {
  private readonly scheduleConfig: ScheduleConfig;
  private readonly configDir: string;
  private readonly configFilePath: string;

  constructor(scheduleConfig: ScheduleConfig, configDir?: string) {
    this.scheduleConfig = scheduleConfig;
    this.configDir = configDir || this.getDefaultConfigDir();
    this.configFilePath = path.join(this.configDir, 'schedule.json');
  }

  /**
   * cron式のバリデーション
   */
  validateCronExpression(expression: string): Result<true, ScheduleError> {
    if (!expression || expression.trim() === '') {
      return err({
        type: 'INVALID_CRON_EXPRESSION',
        expression,
        message: 'cron式が空です',
      });
    }

    const isValid = cron.validate(expression);

    if (!isValid) {
      return err({
        type: 'INVALID_CRON_EXPRESSION',
        expression,
        message: `無効なcron式です: ${expression}`,
      });
    }

    return ok(true);
  }

  /**
   * スケジュールを登録する
   */
  register(
    options: ScheduleRegisterOptions
  ): Result<ScheduleRegistration, ScheduleError> {
    // cron式のバリデーション
    const validationResult = this.validateCronExpression(options.cronExpression);
    if (!validationResult.success) {
      return err(validationResult.error);
    }

    // 既存スケジュールの確認
    const existingConfig = this.loadConfigFile();
    if (existingConfig && existingConfig.registered && !options.force) {
      return err({
        type: 'ALREADY_REGISTERED',
        existingExpression: existingConfig.cronExpression,
      });
    }

    // 設定ファイルの保存
    const configData: ScheduleConfigFile = {
      cronExpression: options.cronExpression,
      registered: true,
      registeredAt: new Date().toISOString(),
    };

    this.saveConfigFile(configData);

    const platform = this.detectPlatform();
    const nextExecution = this.calculateNextExecution(options.cronExpression);

    return ok({
      cronExpression: options.cronExpression,
      nextExecution,
      platform,
      configPath: this.configFilePath,
    });
  }

  /**
   * スケジュールを解除する
   */
  unregister(): Result<void, ScheduleError> {
    const existingConfig = this.loadConfigFile();

    if (!existingConfig || !existingConfig.registered) {
      return err({
        type: 'NOT_REGISTERED',
      });
    }

    // 設定ファイルの削除
    this.deleteConfigFile();

    return ok(undefined);
  }

  /**
   * スケジュール状態を取得する
   */
  getStatus(): Result<ScheduleStatus, ScheduleError> {
    const existingConfig = this.loadConfigFile();
    const platform = this.detectPlatform();

    if (!existingConfig || !existingConfig.registered) {
      return ok({
        registered: false,
        platform,
      });
    }

    const nextExecution = this.calculateNextExecution(existingConfig.cronExpression);

    let lastExecution: ExecutionRecord | undefined;
    if (existingConfig.lastExecution) {
      lastExecution = {
        timestamp: new Date(existingConfig.lastExecution.timestamp),
        success: existingConfig.lastExecution.success,
        pageUrl: existingConfig.lastExecution.pageUrl,
        error: existingConfig.lastExecution.error,
        duration: existingConfig.lastExecution.duration,
      };
    }

    return ok({
      registered: true,
      cronExpression: existingConfig.cronExpression,
      nextExecution,
      lastExecution,
      platform,
    });
  }

  /**
   * デフォルトのcron式を取得する
   */
  getDefaultCronExpression(): string {
    return this.scheduleConfig.cronExpression;
  }

  /**
   * プラットフォーム固有のスケジューラ設定ファイルを生成する
   *
   * macOS launchd plist、Linux systemd timer/service、Linux cron crontabエントリに対応。
   * 各プラットフォームのインストール手順も提供する。
   *
   * Requirements: 9.7
   */
  generatePlatformConfig(
    platform: Platform,
    cronExpression: string,
  ): Result<PlatformConfig, ScheduleError> {
    // cron式のバリデーション
    const validationResult = this.validateCronExpression(cronExpression);
    if (!validationResult.success) {
      return err(validationResult.error);
    }

    const cronParts = this.parseCronExpression(cronExpression);

    switch (platform) {
      case 'macos-launchd':
        return ok(this.generateLaunchdConfig(cronParts));
      case 'linux-systemd':
        return ok(this.generateSystemdConfig(cronParts));
      case 'linux-cron':
        return ok(this.generateCronConfig(cronExpression));
    }
  }

  // --- プライベートメソッド ---

  /**
   * 設定ファイルの読み込み
   */
  private loadConfigFile(): ScheduleConfigFile | null {
    try {
      if (!fs.existsSync(this.configFilePath)) {
        return null;
      }
      const content = fs.readFileSync(this.configFilePath, 'utf-8');
      return JSON.parse(content) as ScheduleConfigFile;
    } catch {
      return null;
    }
  }

  /**
   * 設定ファイルの保存
   */
  private saveConfigFile(config: ScheduleConfigFile): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    fs.writeFileSync(this.configFilePath, JSON.stringify(config, null, 2), 'utf-8');
  }

  /**
   * 設定ファイルの削除
   */
  private deleteConfigFile(): void {
    try {
      if (fs.existsSync(this.configFilePath)) {
        fs.unlinkSync(this.configFilePath);
      }
    } catch {
      // 削除失敗は無視
    }
  }

  /**
   * 次回実行日時の計算（簡易実装）
   */
  private calculateNextExecution(cronExpression: string): Date {
    const now = new Date();
    const parts = cronExpression.split(' ');

    // 標準的な5フィールドcron式: 分 時 日 月 曜日
    if (parts.length >= 5) {
      const minute = parts[0] === '*' ? 0 : parseInt(parts[0], 10);
      const hour = parts[1] === '*' ? 0 : parseInt(parts[1], 10);
      const dayOfWeek = parts[4] === '*' ? -1 : parseInt(parts[4], 10);

      const next = new Date(now);
      next.setSeconds(0);
      next.setMilliseconds(0);
      next.setMinutes(isNaN(minute) ? 0 : minute);
      next.setHours(isNaN(hour) ? 0 : hour);

      if (dayOfWeek >= 0 && !isNaN(dayOfWeek)) {
        // 次の指定曜日を計算
        const currentDay = now.getDay();
        let daysUntil = dayOfWeek - currentDay;
        if (daysUntil < 0 || (daysUntil === 0 && next <= now)) {
          daysUntil += 7;
        }
        next.setDate(now.getDate() + daysUntil);
      } else {
        // 曜日指定がない場合、次の実行時刻を計算
        if (next <= now) {
          next.setDate(next.getDate() + 1);
        }
      }

      return next;
    }

    // パース不可の場合は翌日同時刻を返す
    const fallback = new Date(now);
    fallback.setDate(fallback.getDate() + 1);
    return fallback;
  }

  /**
   * 現在のプラットフォームを検出する
   */
  private detectPlatform(): Platform {
    switch (process.platform) {
      case 'darwin':
        return 'macos-launchd';
      case 'linux':
        // systemdが利用可能か確認
        try {
          if (fs.existsSync('/run/systemd/system')) {
            return 'linux-systemd';
          }
        } catch {
          // ignore
        }
        return 'linux-cron';
      default:
        return 'linux-cron';
    }
  }

  /**
   * デフォルト設定ディレクトリのパスを取得
   */
  private getDefaultConfigDir(): string {
    return path.join(this.getHomeDir(), '.reflection-weekly');
  }

  /**
   * ホームディレクトリのパスを取得
   */
  private getHomeDir(): string {
    return process.env.HOME || process.env.USERPROFILE || '/tmp';
  }

  /**
   * cron式を各フィールドにパースする
   */
  private parseCronExpression(expression: string): CronParts {
    const parts = expression.split(' ');
    return {
      minute: parts[0] ?? '*',
      hour: parts[1] ?? '*',
      dayOfMonth: parts[2] ?? '*',
      month: parts[3] ?? '*',
      dayOfWeek: parts[4] ?? '*',
    };
  }

  /**
   * macOS launchd用のplist設定を生成する
   */
  private generateLaunchdConfig(cronParts: CronParts): PlatformConfig {
    const homeDir = this.getHomeDir();
    const label = 'com.reflection-weekly.schedule';
    const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', `${label}.plist`);
    const logDir = path.join(homeDir, '.reflection-weekly', 'logs');

    // StartCalendarIntervalの構築
    let calendarInterval = '      <dict>\n';

    if (cronParts.dayOfWeek !== '*') {
      // cron: 0=日曜, launchd: 0=日曜（同じ）
      const weekday = parseInt(cronParts.dayOfWeek, 10);
      if (!isNaN(weekday)) {
        calendarInterval += `        <key>Weekday</key>\n        <integer>${weekday}</integer>\n`;
      }
    }

    if (cronParts.hour !== '*') {
      const hour = parseInt(cronParts.hour, 10);
      if (!isNaN(hour)) {
        calendarInterval += `        <key>Hour</key>\n        <integer>${hour}</integer>\n`;
      }
    }

    if (cronParts.minute !== '*') {
      const minute = parseInt(cronParts.minute, 10);
      if (!isNaN(minute)) {
        calendarInterval += `        <key>Minute</key>\n        <integer>${minute}</integer>\n`;
      }
    }

    if (cronParts.dayOfMonth !== '*') {
      const day = parseInt(cronParts.dayOfMonth, 10);
      if (!isNaN(day)) {
        calendarInterval += `        <key>Day</key>\n        <integer>${day}</integer>\n`;
      }
    }

    if (cronParts.month !== '*') {
      const month = parseInt(cronParts.month, 10);
      if (!isNaN(month)) {
        calendarInterval += `        <key>Month</key>\n        <integer>${month}</integer>\n`;
      }
    }

    calendarInterval += '      </dict>';

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>npx</string>
    <string>reflection-weekly</string>
    <string>reflect</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
${calendarInterval}
  </array>
  <key>StandardOutPath</key>
  <string>${logDir}/launchd-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/launchd-stderr.log</string>
  <key>WorkingDirectory</key>
  <string>${homeDir}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
  </dict>
</dict>
</plist>`;

    const installInstructions: string[] = [
      `1. plistファイルを配置します:`,
      `   cp ${plistPath} ~/Library/LaunchAgents/`,
      `2. スケジュールを登録します:`,
      `   launchctl load ~/Library/LaunchAgents/${label}.plist`,
      `3. スケジュールを確認します:`,
      `   launchctl list | grep ${label}`,
      `4. スケジュールを解除する場合:`,
      `   launchctl unload ~/Library/LaunchAgents/${label}.plist`,
    ];

    return {
      platform: 'macos-launchd',
      configContent: plistContent,
      configPath: plistPath,
      installInstructions,
    };
  }

  /**
   * Linux systemd用のtimer/service設定を生成する
   */
  private generateSystemdConfig(cronParts: CronParts): PlatformConfig {
    const homeDir = this.getHomeDir();
    const serviceName = 'reflection-weekly';
    const systemdDir = path.join(homeDir, '.config', 'systemd', 'user');
    const configPath = path.join(systemdDir, `${serviceName}.timer`);

    // cron式をsystemd OnCalendar形式に変換
    const onCalendar = this.cronToSystemdCalendar(cronParts);

    const serviceContent = `# --- ${serviceName}.service ---
[Unit]
Description=週次振り返り自動生成サービス
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/env npx reflection-weekly reflect
WorkingDirectory=${homeDir}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target`;

    const timerContent = `# --- ${serviceName}.timer ---
[Unit]
Description=週次振り返り自動生成タイマー

[Timer]
OnCalendar=${onCalendar}
Persistent=true

[Install]
WantedBy=timers.target`;

    const configContent = `${serviceContent}\n\n${timerContent}`;

    const installInstructions: string[] = [
      `1. systemdユーザーディレクトリを作成します:`,
      `   mkdir -p ${systemdDir}`,
      `2. serviceファイルを配置します:`,
      `   上記のserviceセクションを ${systemdDir}/${serviceName}.service として保存`,
      `3. timerファイルを配置します:`,
      `   上記のtimerセクションを ${systemdDir}/${serviceName}.timer として保存`,
      `4. systemdデーモンをリロードします:`,
      `   systemctl --user daemon-reload`,
      `5. timerを有効化・起動します:`,
      `   systemctl --user enable --now ${serviceName}.timer`,
      `6. timerの状態を確認します:`,
      `   systemctl --user status ${serviceName}.timer`,
      `7. timerを停止・無効化する場合:`,
      `   systemctl --user disable --now ${serviceName}.timer`,
    ];

    return {
      platform: 'linux-systemd',
      configContent,
      configPath,
      installInstructions,
    };
  }

  /**
   * Linux cron用のcrontabエントリを生成する
   */
  private generateCronConfig(cronExpression: string): PlatformConfig {
    const homeDir = this.getHomeDir();
    const logDir = path.join(homeDir, '.reflection-weekly', 'logs');
    const logFile = path.join(logDir, 'cron-execution.log');

    const cronEntry = `# reflection-weekly: 週次振り返り自動生成
# 生成日時: ${new Date().toISOString()}
${cronExpression} cd ${homeDir} && npx reflection-weekly reflect >> ${logFile} 2>&1`;

    const installInstructions: string[] = [
      `1. ログディレクトリを作成します:`,
      `   mkdir -p ${logDir}`,
      `2. 現在のcrontabを確認します:`,
      `   crontab -l`,
      `3. crontabにエントリを追加します:`,
      `   (crontab -l 2>/dev/null; echo '${cronExpression} cd ${homeDir} && npx reflection-weekly reflect >> ${logFile} 2>&1') | crontab -`,
      `4. 登録を確認します:`,
      `   crontab -l | grep reflection-weekly`,
      `5. エントリを削除する場合:`,
      `   crontab -l | grep -v reflection-weekly | crontab -`,
    ];

    return {
      platform: 'linux-cron',
      configContent: cronEntry,
      configPath: path.join(homeDir, '.reflection-weekly', 'crontab-entry.txt'),
      installInstructions,
    };
  }

  /**
   * cron式をsystemd OnCalendar形式に変換する
   *
   * cron: 分 時 日 月 曜日
   * systemd: DayOfWeek Year-Month-Day Hour:Minute:Second
   */
  private cronToSystemdCalendar(cronParts: CronParts): string {
    const dayOfWeekMap: Record<string, string> = {
      '0': 'Sun',
      '1': 'Mon',
      '2': 'Tue',
      '3': 'Wed',
      '4': 'Thu',
      '5': 'Fri',
      '6': 'Sat',
      '7': 'Sun',
    };

    let calendar = '';

    // 曜日
    if (cronParts.dayOfWeek !== '*') {
      // "1-5" のような範囲指定に対応
      const dayParts = cronParts.dayOfWeek.split('-');
      if (dayParts.length === 2) {
        const start = dayOfWeekMap[dayParts[0]] ?? dayParts[0];
        const end = dayOfWeekMap[dayParts[1]] ?? dayParts[1];
        calendar += `${start}..${end} `;
      } else {
        const dayName = dayOfWeekMap[cronParts.dayOfWeek] ?? cronParts.dayOfWeek;
        calendar += `${dayName} `;
      }
    }

    // 日付部分: Year-Month-Day
    const monthPart = cronParts.month === '*' ? '*' : cronParts.month;
    const dayPart = cronParts.dayOfMonth === '*' ? '*' : cronParts.dayOfMonth;
    calendar += `*-${monthPart}-${dayPart} `;

    // 時刻部分: Hour:Minute:00
    const hourPart = cronParts.hour === '*' ? '*' : cronParts.hour.padStart(2, '0');
    const minutePart = cronParts.minute === '*' ? '*' : cronParts.minute.padStart(2, '0');
    calendar += `${hourPart}:${minutePart}:00`;

    return calendar;
  }
}

/**
 * cron式の各フィールドを保持する内部型
 */
interface CronParts {
  readonly minute: string;
  readonly hour: string;
  readonly dayOfMonth: string;
  readonly month: string;
  readonly dayOfWeek: string;
}
