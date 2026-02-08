/**
 * エンドツーエンドテスト: Task 7.3 (スケジュール統合)
 *
 * スケジュール登録・解除コマンドの実際のScheduleManagerを使用した
 * エンドツーエンドテスト。ファイルシステムへの書き込みを含む
 * 完全なフローを検証する。
 *
 * Requirements: 9.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ok, err } from '../types/result.js';
import { ScheduleManager } from '../infrastructure/schedule/schedule-manager.js';
import type { ScheduleConfig } from '../infrastructure/config/config-manager.js';
import {
  ScheduleCommandHandler,
} from '../presentation/schedule-command.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// node-cronのモック
vi.mock('node-cron', () => {
  const validateFn = (expression: string): boolean => {
    const validExpressions = [
      '0 19 * * 0',
      '0 20 * * 1',
      '*/5 * * * *',
      '0 0 1 * *',
      '30 9 * * 1-5',
    ];
    const invalidExpressions = ['invalid', 'bad-cron', '60 25 * * *', '* * * *', ''];
    if (invalidExpressions.includes(expression)) return false;
    if (validExpressions.includes(expression)) return true;
    const parts = expression.split(' ');
    return parts.length === 5 || parts.length === 6;
  };
  return {
    default: { validate: validateFn },
    validate: validateFn,
  };
});

describe('E2E: ScheduleManager + ScheduleCommandHandler 統合テスト', () => {
  let testConfigDir: string;
  let scheduleManager: ScheduleManager;
  let handler: ScheduleCommandHandler;

  const defaultScheduleConfig: ScheduleConfig = {
    cronExpression: '0 19 * * 0',
    timezone: 'Asia/Tokyo',
    enabled: false,
  };

  beforeEach(() => {
    // テスト毎にユニークな一時ディレクトリを作成
    testConfigDir = path.join(os.tmpdir(), `e2e-schedule-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    fs.mkdirSync(testConfigDir, { recursive: true });

    scheduleManager = new ScheduleManager(defaultScheduleConfig, testConfigDir);
    handler = new ScheduleCommandHandler(scheduleManager);
  });

  afterEach(() => {
    // テストディレクトリのクリーンアップ
    try {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    } catch {
      // クリーンアップ失敗は無視
    }
  });

  describe('スケジュール登録の完全フロー', () => {
    it('デフォルトcron式で登録→設定ファイル作成→ステータス確認の全フロー', async () => {
      // Step 1: 登録
      const registerResult = await handler.handleRegister({
        force: false,
      });

      expect(registerResult.success).toBe(true);
      if (!registerResult.success) return;

      expect(registerResult.value.cronExpression).toBe('0 19 * * 0');
      expect(registerResult.value.nextExecution).toBeInstanceOf(Date);
      expect(registerResult.value.configPath).toBeDefined();
      expect(registerResult.value.message).toContain('スケジュール');

      // Step 2: 設定ファイルの実在確認
      const configFilePath = path.join(testConfigDir, 'schedule.json');
      expect(fs.existsSync(configFilePath)).toBe(true);

      const configContent = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
      expect(configContent.cronExpression).toBe('0 19 * * 0');
      expect(configContent.registered).toBe(true);

      // Step 3: ステータス確認
      const statusResult = await handler.handleStatus();

      expect(statusResult.success).toBe(true);
      if (!statusResult.success) return;

      expect(statusResult.value.registered).toBe(true);
      expect(statusResult.value.cronExpression).toBe('0 19 * * 0');
      expect(statusResult.value.nextExecution).toBeInstanceOf(Date);
    });

    it('カスタムcron式（毎週月曜20:00）で登録→確認の全フロー', async () => {
      const registerResult = await handler.handleRegister({
        cron: '0 20 * * 1',
        force: false,
      });

      expect(registerResult.success).toBe(true);
      if (!registerResult.success) return;

      expect(registerResult.value.cronExpression).toBe('0 20 * * 1');

      // ステータス確認
      const statusResult = await handler.handleStatus();

      expect(statusResult.success).toBe(true);
      if (!statusResult.success) return;

      expect(statusResult.value.cronExpression).toBe('0 20 * * 1');
    });
  });

  describe('スケジュール解除の完全フロー', () => {
    it('登録→解除→設定ファイル削除→ステータス未登録の全フロー', async () => {
      // Step 1: 登録
      const registerResult = await handler.handleRegister({
        force: false,
      });
      expect(registerResult.success).toBe(true);

      // 設定ファイルの存在確認
      const configFilePath = path.join(testConfigDir, 'schedule.json');
      expect(fs.existsSync(configFilePath)).toBe(true);

      // Step 2: 解除
      const unregisterResult = await handler.handleUnregister();
      expect(unregisterResult.success).toBe(true);
      if (unregisterResult.success) {
        expect(unregisterResult.value.message).toContain('解除');
      }

      // Step 3: 設定ファイルが削除されている
      expect(fs.existsSync(configFilePath)).toBe(false);

      // Step 4: ステータス確認（未登録）
      const statusResult = await handler.handleStatus();
      expect(statusResult.success).toBe(true);
      if (statusResult.success) {
        expect(statusResult.value.registered).toBe(false);
      }
    });

    it('未登録状態で解除を試みるとエラーが返される', async () => {
      const unregisterResult = await handler.handleUnregister();

      expect(unregisterResult.success).toBe(false);
      if (!unregisterResult.success) {
        expect(unregisterResult.error.message).toBeDefined();
        expect(unregisterResult.error.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe('重複登録の防止と--forceオプション', () => {
    it('同じcron式での重複登録はエラーを返す', async () => {
      // 最初の登録
      const firstResult = await handler.handleRegister({
        cron: '0 19 * * 0',
        force: false,
      });
      expect(firstResult.success).toBe(true);

      // 重複登録
      const secondResult = await handler.handleRegister({
        cron: '0 20 * * 1',
        force: false,
      });

      expect(secondResult.success).toBe(false);
      if (!secondResult.success) {
        expect(secondResult.error.message).toContain('0 19 * * 0');
        expect(secondResult.error.message).toContain('--force');
      }
    });

    it('--forceオプションで既存スケジュールを上書きできる', async () => {
      // 最初の登録
      const firstResult = await handler.handleRegister({
        cron: '0 19 * * 0',
        force: false,
      });
      expect(firstResult.success).toBe(true);

      // forceで上書き
      const secondResult = await handler.handleRegister({
        cron: '0 20 * * 1',
        force: true,
      });

      expect(secondResult.success).toBe(true);
      if (secondResult.success) {
        expect(secondResult.value.cronExpression).toBe('0 20 * * 1');
      }

      // ステータス確認（新しいcron式が反映されている）
      const statusResult = await handler.handleStatus();
      expect(statusResult.success).toBe(true);
      if (statusResult.success) {
        expect(statusResult.value.cronExpression).toBe('0 20 * * 1');
      }
    });
  });

  describe('無効な入力のバリデーション', () => {
    it('無効なcron式で登録を試みるとエラーメッセージを返す', async () => {
      const result = await handler.handleRegister({
        cron: 'invalid',
        force: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('invalid');
      }
    });

    it('空のcron式はデフォルトcron式にフォールバックして成功する', async () => {
      // 空文字列はJavaScriptのfalsyなのでデフォルトcron式が使用される
      const result = await handler.handleRegister({
        cron: '',
        force: false,
      });

      expect(result.success).toBe(true);
      if (result.success) {
        // デフォルトcron式（0 19 * * 0）で登録される
        expect(result.value.cronExpression).toBe('0 19 * * 0');
      }
    });

    it('不正なフォーマットのcron式で登録を試みるとエラーメッセージを返す', async () => {
      const result = await handler.handleRegister({
        cron: 'bad-cron',
        force: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toContain('bad-cron');
      }
    });
  });

  describe('設定ファイルの永続化と復元', () => {
    it('新しいScheduleManagerインスタンスが既存の設定ファイルを読み込む', async () => {
      // 登録
      const registerResult = await handler.handleRegister({
        cron: '0 19 * * 0',
        force: false,
      });
      expect(registerResult.success).toBe(true);

      // 新しいインスタンスを作成（同じ設定ディレクトリを使用）
      const newScheduleManager = new ScheduleManager(defaultScheduleConfig, testConfigDir);
      const newHandler = new ScheduleCommandHandler(newScheduleManager);

      // ステータス確認（永続化された設定が読み込まれる）
      const statusResult = await newHandler.handleStatus();

      expect(statusResult.success).toBe(true);
      if (statusResult.success) {
        expect(statusResult.value.registered).toBe(true);
        expect(statusResult.value.cronExpression).toBe('0 19 * * 0');
      }
    });
  });

  describe('登録→確認→上書き→確認→解除→確認の完全ライフサイクル', () => {
    it('スケジュールの完全なライフサイクルが正常に動作する', async () => {
      // Step 1: 初期登録（日曜19:00）
      const register1 = await handler.handleRegister({
        cron: '0 19 * * 0',
        force: false,
      });
      expect(register1.success).toBe(true);

      // Step 2: ステータス確認（日曜19:00で登録済み）
      let status = await handler.handleStatus();
      expect(status.success).toBe(true);
      if (status.success) {
        expect(status.value.registered).toBe(true);
        expect(status.value.cronExpression).toBe('0 19 * * 0');
      }

      // Step 3: 上書き登録（月曜20:00に変更）
      const register2 = await handler.handleRegister({
        cron: '0 20 * * 1',
        force: true,
      });
      expect(register2.success).toBe(true);
      if (register2.success) {
        expect(register2.value.cronExpression).toBe('0 20 * * 1');
      }

      // Step 4: ステータス確認（月曜20:00に更新されている）
      status = await handler.handleStatus();
      expect(status.success).toBe(true);
      if (status.success) {
        expect(status.value.registered).toBe(true);
        expect(status.value.cronExpression).toBe('0 20 * * 1');
      }

      // Step 5: 解除
      const unregister = await handler.handleUnregister();
      expect(unregister.success).toBe(true);

      // Step 6: ステータス確認（未登録）
      status = await handler.handleStatus();
      expect(status.success).toBe(true);
      if (status.success) {
        expect(status.value.registered).toBe(false);
      }
    });
  });
});
