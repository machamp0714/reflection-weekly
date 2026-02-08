import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScheduleManager } from './schedule-manager.js';
import type { ScheduleConfig } from '../config/config-manager.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// node-cronのモック
vi.mock('node-cron', () => {
  const validateFn = (expression: string): boolean => {
    // 有効なcron式のパターン
    const validExpressions = [
      '0 19 * * 0',
      '0 20 * * 1',
      '*/5 * * * *',
      '0 0 1 * *',
      '30 9 * * 1-5',
    ];
    // 無効なcron式のパターン
    const invalidExpressions = ['invalid', '60 25 * * *', '* * * *', ''];
    if (invalidExpressions.includes(expression)) return false;
    if (validExpressions.includes(expression)) return true;
    // デフォルト: 基本的なフォーマットチェック
    const parts = expression.split(' ');
    return parts.length === 5 || parts.length === 6;
  };
  return {
    default: { validate: validateFn },
    validate: validateFn,
  };
});

describe('ScheduleManager', () => {
  let scheduleManager: ScheduleManager;
  let testConfigDir: string;

  const defaultScheduleConfig: ScheduleConfig = {
    cronExpression: '0 19 * * 0',
    timezone: 'Asia/Tokyo',
    enabled: false,
  };

  beforeEach(() => {
    testConfigDir = path.join(os.tmpdir(), `schedule-manager-test-${Date.now()}`);
    fs.mkdirSync(testConfigDir, { recursive: true });
    scheduleManager = new ScheduleManager(defaultScheduleConfig, testConfigDir);
  });

  afterEach(() => {
    // テストディレクトリのクリーンアップ
    try {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    } catch {
      // クリーンアップ失敗は無視
    }
  });

  describe('validateCronExpression', () => {
    it('有効なcron式を正しく検証する', () => {
      const result = scheduleManager.validateCronExpression('0 19 * * 0');
      expect(result.success).toBe(true);
    });

    it('デフォルトスケジュール（毎週日曜日19:00）を検証する', () => {
      const result = scheduleManager.validateCronExpression('0 19 * * 0');
      expect(result.success).toBe(true);
    });

    it('様々な有効なcron式を検証する', () => {
      const validExpressions = [
        '0 20 * * 1',     // 毎週月曜20:00
        '*/5 * * * *',    // 5分毎
        '0 0 1 * *',      // 毎月1日0:00
        '30 9 * * 1-5',   // 平日9:30
      ];

      for (const expr of validExpressions) {
        const result = scheduleManager.validateCronExpression(expr);
        expect(result.success).toBe(true);
      }
    });

    it('無効なcron式でエラーを返す', () => {
      const result = scheduleManager.validateCronExpression('invalid');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_CRON_EXPRESSION');
        expect(result.error.expression).toBe('invalid');
      }
    });

    it('空文字列でエラーを返す', () => {
      const result = scheduleManager.validateCronExpression('');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_CRON_EXPRESSION');
      }
    });

    it('不正な値を含むcron式でエラーを返す', () => {
      const result = scheduleManager.validateCronExpression('60 25 * * *');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_CRON_EXPRESSION');
      }
    });

    it('フィールド数が不足するcron式でエラーを返す', () => {
      const result = scheduleManager.validateCronExpression('* * * *');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_CRON_EXPRESSION');
      }
    });
  });

  describe('register', () => {
    it('新規スケジュールを登録できる', async () => {
      const result = await scheduleManager.register({
        cronExpression: '0 19 * * 0',
        force: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.cronExpression).toBe('0 19 * * 0');
        expect(result.value.configPath).toBeDefined();
        expect(result.value.nextExecution).toBeInstanceOf(Date);
      }
    });

    it('デフォルトのcron式（毎週日曜19:00）で登録できる', async () => {
      const result = await scheduleManager.register({
        cronExpression: '0 19 * * 0',
        force: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.cronExpression).toBe('0 19 * * 0');
      }
    });

    it('既存スケジュールがある場合エラーを返す（forceなし）', async () => {
      // 最初のスケジュール登録
      await scheduleManager.register({
        cronExpression: '0 19 * * 0',
        force: false,
      });

      // 2回目の登録はエラー
      const result = await scheduleManager.register({
        cronExpression: '0 20 * * 1',
        force: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('ALREADY_REGISTERED');
        expect(result.error.existingExpression).toBe('0 19 * * 0');
      }
    });

    it('forceオプションで既存スケジュールを上書きできる', async () => {
      // 最初のスケジュール登録
      await scheduleManager.register({
        cronExpression: '0 19 * * 0',
        force: false,
      });

      // forceで上書き
      const result = await scheduleManager.register({
        cronExpression: '0 20 * * 1',
        force: true,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.cronExpression).toBe('0 20 * * 1');
      }
    });

    it('無効なcron式で登録を拒否する', async () => {
      const result = await scheduleManager.register({
        cronExpression: 'invalid',
        force: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('INVALID_CRON_EXPRESSION');
      }
    });

    it('登録後に設定ファイルが作成される', async () => {
      const result = await scheduleManager.register({
        cronExpression: '0 19 * * 0',
        force: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        const configPath = result.value.configPath;
        expect(fs.existsSync(configPath)).toBe(true);

        const configContent = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        expect(configContent.cronExpression).toBe('0 19 * * 0');
        expect(configContent.registered).toBe(true);
      }
    });
  });

  describe('unregister', () => {
    it('登録済みスケジュールを解除できる', async () => {
      // まず登録
      await scheduleManager.register({
        cronExpression: '0 19 * * 0',
        force: false,
      });

      // 解除
      const result = await scheduleManager.unregister();

      expect(result.success).toBe(true);
    });

    it('未登録の状態で解除するとエラーを返す', async () => {
      const result = await scheduleManager.unregister();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('NOT_REGISTERED');
      }
    });

    it('解除後に設定ファイルが削除される', async () => {
      // 登録
      const registerResult = await scheduleManager.register({
        cronExpression: '0 19 * * 0',
        force: false,
      });
      expect(registerResult.success).toBe(true);

      // 解除
      await scheduleManager.unregister();

      // 設定ファイルが削除されていることを確認
      if (registerResult.success) {
        expect(fs.existsSync(registerResult.value.configPath)).toBe(false);
      }
    });

    it('解除後にステータスが未登録になる', async () => {
      // 登録
      await scheduleManager.register({
        cronExpression: '0 19 * * 0',
        force: false,
      });

      // 解除
      await scheduleManager.unregister();

      // ステータス確認
      const status = await scheduleManager.getStatus();
      expect(status.success).toBe(true);
      if (status.success) {
        expect(status.value.registered).toBe(false);
      }
    });
  });

  describe('getStatus', () => {
    it('未登録時のステータスを返す', async () => {
      const result = await scheduleManager.getStatus();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.registered).toBe(false);
        expect(result.value.cronExpression).toBeUndefined();
        expect(result.value.nextExecution).toBeUndefined();
      }
    });

    it('登録済みのステータスを返す', async () => {
      await scheduleManager.register({
        cronExpression: '0 19 * * 0',
        force: false,
      });

      const result = await scheduleManager.getStatus();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.registered).toBe(true);
        expect(result.value.cronExpression).toBe('0 19 * * 0');
        expect(result.value.nextExecution).toBeInstanceOf(Date);
      }
    });

    it('登録済みステータスにプラットフォーム情報を含む', async () => {
      await scheduleManager.register({
        cronExpression: '0 19 * * 0',
        force: false,
      });

      const result = await scheduleManager.getStatus();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.platform).toBeDefined();
        // macOSの場合
        if (process.platform === 'darwin') {
          expect(result.value.platform).toBe('macos-launchd');
        }
      }
    });

    it('既存の設定ファイルからステータスを復元できる', async () => {
      // 設定ファイルを直接作成
      const configFilePath = path.join(testConfigDir, 'schedule.json');
      const configData = {
        cronExpression: '0 20 * * 1',
        registered: true,
        registeredAt: new Date().toISOString(),
      };
      fs.writeFileSync(configFilePath, JSON.stringify(configData), 'utf-8');

      // 新しいインスタンスでステータスを確認
      const newManager = new ScheduleManager(defaultScheduleConfig, testConfigDir);
      const result = await newManager.getStatus();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.registered).toBe(true);
        expect(result.value.cronExpression).toBe('0 20 * * 1');
      }
    });
  });

  describe('getDefaultCronExpression', () => {
    it('デフォルトのcron式を取得できる', () => {
      const defaultCron = scheduleManager.getDefaultCronExpression();
      expect(defaultCron).toBe('0 19 * * 0');
    });

    it('カスタム設定のデフォルトcron式を取得できる', () => {
      const customConfig: ScheduleConfig = {
        cronExpression: '0 20 * * 1',
        timezone: 'Asia/Tokyo',
        enabled: false,
      };
      const customManager = new ScheduleManager(customConfig, testConfigDir);
      const defaultCron = customManager.getDefaultCronExpression();
      expect(defaultCron).toBe('0 20 * * 1');
    });
  });

  describe('generatePlatformConfig', () => {
    describe('macOS launchd plistファイル生成', () => {
      it('macOS launchd用のplist設定を生成する', () => {
        const result = scheduleManager.generatePlatformConfig('macos-launchd', '0 19 * * 0');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.platform).toBe('macos-launchd');
          expect(result.value.configContent).toContain('<?xml');
          expect(result.value.configContent).toContain('plist');
          expect(result.value.configContent).toContain('Label');
        }
      });

      it('plistファイルにreflection-weeklyのラベルが含まれる', () => {
        const result = scheduleManager.generatePlatformConfig('macos-launchd', '0 19 * * 0');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.configContent).toContain('com.reflection-weekly.schedule');
        }
      });

      it('plistファイルにスケジュール時刻が反映される', () => {
        const result = scheduleManager.generatePlatformConfig('macos-launchd', '0 19 * * 0');

        expect(result.success).toBe(true);
        if (result.success) {
          // 日曜日19:00 => Hour=19, Minute=0, Weekday=0
          expect(result.value.configContent).toContain('<key>Hour</key>');
          expect(result.value.configContent).toContain('<integer>19</integer>');
          expect(result.value.configContent).toContain('<key>Minute</key>');
          expect(result.value.configContent).toContain('<integer>0</integer>');
          expect(result.value.configContent).toContain('<key>Weekday</key>');
          expect(result.value.configContent).toContain('<integer>0</integer>');
        }
      });

      it('plistファイルにreflection-weeklyコマンドのパスが含まれる', () => {
        const result = scheduleManager.generatePlatformConfig('macos-launchd', '0 19 * * 0');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.configContent).toContain('ProgramArguments');
          expect(result.value.configContent).toContain('reflection-weekly');
        }
      });

      it('plistファイルの設定パスがLaunchAgentsディレクトリを指す', () => {
        const result = scheduleManager.generatePlatformConfig('macos-launchd', '0 19 * * 0');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.configPath).toContain('LaunchAgents');
          expect(result.value.configPath).toContain('.plist');
        }
      });

      it('macOS launchd用のインストール手順が提供される', () => {
        const result = scheduleManager.generatePlatformConfig('macos-launchd', '0 19 * * 0');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.installInstructions.length).toBeGreaterThan(0);
          // launchctlコマンドが含まれること
          const allInstructions = result.value.installInstructions.join('\n');
          expect(allInstructions).toContain('launchctl');
        }
      });

      it('異なるcron式でplistのスケジュールが変わる', () => {
        const result = scheduleManager.generatePlatformConfig('macos-launchd', '30 9 * * 1-5');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.configContent).toContain('<key>Hour</key>');
          expect(result.value.configContent).toContain('<integer>9</integer>');
          expect(result.value.configContent).toContain('<key>Minute</key>');
          expect(result.value.configContent).toContain('<integer>30</integer>');
        }
      });
    });

    describe('Linux systemd timer/service ファイル生成', () => {
      it('Linux systemd用のtimer設定を生成する', () => {
        const result = scheduleManager.generatePlatformConfig('linux-systemd', '0 19 * * 0');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.platform).toBe('linux-systemd');
          // timerとserviceの両方が含まれる
          expect(result.value.configContent).toContain('[Timer]');
          expect(result.value.configContent).toContain('[Service]');
        }
      });

      it('systemd timerにOnCalendarスケジュールが含まれる', () => {
        const result = scheduleManager.generatePlatformConfig('linux-systemd', '0 19 * * 0');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.configContent).toContain('OnCalendar=');
        }
      });

      it('systemd serviceにreflection-weeklyコマンドが含まれる', () => {
        const result = scheduleManager.generatePlatformConfig('linux-systemd', '0 19 * * 0');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.configContent).toContain('ExecStart=');
          expect(result.value.configContent).toContain('reflection-weekly');
        }
      });

      it('systemd用のインストール手順が提供される', () => {
        const result = scheduleManager.generatePlatformConfig('linux-systemd', '0 19 * * 0');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.installInstructions.length).toBeGreaterThan(0);
          const allInstructions = result.value.installInstructions.join('\n');
          expect(allInstructions).toContain('systemctl');
        }
      });

      it('systemd設定パスがsystemdユーザーディレクトリを指す', () => {
        const result = scheduleManager.generatePlatformConfig('linux-systemd', '0 19 * * 0');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.configPath).toContain('.config/systemd/user');
        }
      });

      it('systemd timerにPersistent=trueが含まれる', () => {
        const result = scheduleManager.generatePlatformConfig('linux-systemd', '0 19 * * 0');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.configContent).toContain('Persistent=true');
        }
      });
    });

    describe('Linux cron crontabエントリ生成', () => {
      it('Linux cron用のcrontabエントリを生成する', () => {
        const result = scheduleManager.generatePlatformConfig('linux-cron', '0 19 * * 0');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.platform).toBe('linux-cron');
          expect(result.value.configContent).toContain('0 19 * * 0');
          expect(result.value.configContent).toContain('reflection-weekly');
        }
      });

      it('crontabエントリにコマンドのフルパスが含まれる', () => {
        const result = scheduleManager.generatePlatformConfig('linux-cron', '0 19 * * 0');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.configContent).toContain('npx reflection-weekly');
        }
      });

      it('crontab用のインストール手順が提供される', () => {
        const result = scheduleManager.generatePlatformConfig('linux-cron', '0 19 * * 0');

        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.value.installInstructions.length).toBeGreaterThan(0);
          const allInstructions = result.value.installInstructions.join('\n');
          expect(allInstructions).toContain('crontab');
        }
      });

      it('crontabエントリにログ出力先が含まれる', () => {
        const result = scheduleManager.generatePlatformConfig('linux-cron', '0 19 * * 0');

        expect(result.success).toBe(true);
        if (result.success) {
          // ログ出力のリダイレクトが含まれる
          expect(result.value.configContent).toContain('>>');
        }
      });
    });

    describe('共通のバリデーション', () => {
      it('無効なcron式でエラーを返す', () => {
        const result = scheduleManager.generatePlatformConfig('macos-launchd', 'invalid');

        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.type).toBe('INVALID_CRON_EXPRESSION');
        }
      });

      it('全プラットフォームでPlatformConfig型の構造を返す', () => {
        const platforms: Array<'macos-launchd' | 'linux-systemd' | 'linux-cron'> = [
          'macos-launchd',
          'linux-systemd',
          'linux-cron',
        ];

        for (const platform of platforms) {
          const result = scheduleManager.generatePlatformConfig(platform, '0 19 * * 0');

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.value).toHaveProperty('platform');
            expect(result.value).toHaveProperty('configContent');
            expect(result.value).toHaveProperty('configPath');
            expect(result.value).toHaveProperty('installInstructions');
          }
        }
      });
    });
  });
});
