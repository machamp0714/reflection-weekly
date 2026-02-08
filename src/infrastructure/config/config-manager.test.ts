import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigManager, ConfigError, AppConfig } from './config-manager.js';

describe('ConfigManager', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    // 完全にクリーンな環境変数で開始（テスト分離のため）
    process.env = {};
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('load', () => {
    it('should load configuration from environment variables', () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token';
      process.env.GITHUB_REPOSITORIES = 'owner/repo1,owner/repo2';
      process.env.TOGGL_API_TOKEN = 'toggl_test_token';
      process.env.NOTION_TOKEN = 'secret_notion_token';
      process.env.NOTION_DATABASE_ID = 'notion_db_id';
      process.env.OPENAI_API_KEY = 'sk-test-key';

      const manager = new ConfigManager();
      const result = manager.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.github.token).toBe('ghp_test_token');
        expect(result.value.github.repositories).toEqual(['owner/repo1', 'owner/repo2']);
        expect(result.value.toggl.apiToken).toBe('toggl_test_token');
        expect(result.value.notion.token).toBe('secret_notion_token');
        expect(result.value.notion.databaseId).toBe('notion_db_id');
        expect(result.value.openai.apiKey).toBe('sk-test-key');
      }
    });

    it('should return error when required fields are missing', () => {
      // Only set some required fields
      process.env.GITHUB_TOKEN = 'ghp_test_token';
      // Missing: TOGGL_API_TOKEN, NOTION_TOKEN, NOTION_DATABASE_ID, OPENAI_API_KEY

      const manager = new ConfigManager();
      const result = manager.load();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MISSING_REQUIRED');
        expect(result.error.missingFields).toContain('TOGGL_API_TOKEN');
        expect(result.error.missingFields).toContain('NOTION_TOKEN');
        expect(result.error.missingFields).toContain('NOTION_DATABASE_ID');
        expect(result.error.missingFields).toContain('OPENAI_API_KEY');
      }
    });

    it('should apply default values for optional fields', () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token';
      process.env.GITHUB_REPOSITORIES = 'owner/repo1';
      process.env.TOGGL_API_TOKEN = 'toggl_test_token';
      process.env.NOTION_TOKEN = 'secret_notion_token';
      process.env.NOTION_DATABASE_ID = 'notion_db_id';
      process.env.OPENAI_API_KEY = 'sk-test-key';

      const manager = new ConfigManager();
      const result = manager.load();

      expect(result.success).toBe(true);
      if (result.success) {
        // Check default values
        expect(result.value.openai.model).toBe('gpt-4o');
        expect(result.value.reflection.defaultPeriodDays).toBe(7);
        expect(result.value.schedule.cronExpression).toBe('0 19 * * 0');
        expect(result.value.schedule.timezone).toBe('Asia/Tokyo');
        expect(result.value.schedule.enabled).toBe(false);
        expect(result.value.logging.logLevel).toBe('info');
      }
    });

    it('should allow overriding default values', () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token';
      process.env.GITHUB_REPOSITORIES = 'owner/repo1';
      process.env.TOGGL_API_TOKEN = 'toggl_test_token';
      process.env.NOTION_TOKEN = 'secret_notion_token';
      process.env.NOTION_DATABASE_ID = 'notion_db_id';
      process.env.OPENAI_API_KEY = 'sk-test-key';
      process.env.OPENAI_MODEL = 'gpt-4-turbo';
      process.env.REFLECTION_DEFAULT_PERIOD_DAYS = '14';
      process.env.SCHEDULE_CRON = '0 20 * * 1';
      process.env.LOG_LEVEL = 'debug';

      const manager = new ConfigManager();
      const result = manager.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.openai.model).toBe('gpt-4-turbo');
        expect(result.value.reflection.defaultPeriodDays).toBe(14);
        expect(result.value.schedule.cronExpression).toBe('0 20 * * 1');
        expect(result.value.logging.logLevel).toBe('debug');
      }
    });

    it('should parse GITHUB_USERNAME when provided', () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token';
      process.env.GITHUB_REPOSITORIES = 'owner/repo1';
      process.env.GITHUB_USERNAME = 'testuser';
      process.env.TOGGL_API_TOKEN = 'toggl_test_token';
      process.env.NOTION_TOKEN = 'secret_notion_token';
      process.env.NOTION_DATABASE_ID = 'notion_db_id';
      process.env.OPENAI_API_KEY = 'sk-test-key';

      const manager = new ConfigManager();
      const result = manager.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.github.username).toBe('testuser');
      }
    });

    it('should parse TOGGL_WORKSPACE_ID when provided', () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token';
      process.env.GITHUB_REPOSITORIES = 'owner/repo1';
      process.env.TOGGL_API_TOKEN = 'toggl_test_token';
      process.env.TOGGL_WORKSPACE_ID = '12345';
      process.env.NOTION_TOKEN = 'secret_notion_token';
      process.env.NOTION_DATABASE_ID = 'notion_db_id';
      process.env.OPENAI_API_KEY = 'sk-test-key';

      const manager = new ConfigManager();
      const result = manager.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.toggl.workspaceId).toBe(12345);
      }
    });
  });

  describe('validate', () => {
    it('should validate a complete config', () => {
      const manager = new ConfigManager();
      const partialConfig = {
        github: { token: 'test', repositories: ['repo'] },
        toggl: { apiToken: 'test' },
        notion: { token: 'test', databaseId: 'test' },
        openai: { apiKey: 'test' },
      };

      const result = manager.validate(partialConfig);

      expect(result.success).toBe(true);
    });

    it('should return error for incomplete config', () => {
      const manager = new ConfigManager();
      const partialConfig = {
        github: { token: 'test', repositories: ['repo'] },
        // Missing toggl, notion, openai
      };

      const result = manager.validate(partialConfig);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MISSING_REQUIRED');
      }
    });
  });

  describe('maskSensitiveData', () => {
    it('should mask tokens in config for logging', () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token_12345';
      process.env.GITHUB_REPOSITORIES = 'owner/repo1';
      process.env.TOGGL_API_TOKEN = 'toggl_test_token_abc';
      process.env.NOTION_TOKEN = 'secret_notion_token_xyz';
      process.env.NOTION_DATABASE_ID = 'notion_db_id';
      process.env.OPENAI_API_KEY = 'sk-test-key-12345';

      const manager = new ConfigManager();
      const result = manager.load();

      expect(result.success).toBe(true);
      if (result.success) {
        const masked = manager.maskSensitiveData(result.value);
        // Tokens with _ or - show 4 chars, others show 3 chars
        expect(masked.github.token).toBe('ghp_***');
        expect(masked.toggl.apiToken).toBe('togg***'); // toggl_test_token contains _
        expect(masked.notion.token).toBe('secr***'); // secret_notion_token contains _
        expect(masked.openai.apiKey).toBe('sk-t***'); // sk-test-key contains -
      }
    });

    it('短いトークンを完全にマスクする', () => {
      const manager = new ConfigManager();
      const config: AppConfig = {
        github: { token: 'abc', repositories: ['repo'] },
        toggl: { apiToken: 'xyz' },
        notion: { token: 'short', databaseId: 'db' },
        openai: { apiKey: '12345', model: 'gpt-4o' },
        reflection: { defaultPeriodDays: 7 },
        schedule: { cronExpression: '0 19 * * 0', timezone: 'Asia/Tokyo', enabled: false },
        logging: { logFilePath: '/tmp/test.log', logLevel: 'info', maxLogFiles: 10, maxLogSize: '10MB' },
      };

      const masked = manager.maskSensitiveData(config);
      // 6文字以下のトークンは全て'***'にマスクされる
      expect(masked.github.token).toBe('***');
      expect(masked.toggl.apiToken).toBe('***');
      expect(masked.notion.token).toBe('***');
      expect(masked.openai.apiKey).toBe('***');
    });
  });

  describe('load - GITHUB_REPOSITORIES必須チェック', () => {
    it('GITHUB_REPOSITORIESが空の場合にエラーを返す', () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token';
      process.env.GITHUB_REPOSITORIES = '';
      process.env.TOGGL_API_TOKEN = 'toggl_test_token';
      process.env.NOTION_TOKEN = 'secret_notion_token';
      process.env.NOTION_DATABASE_ID = 'notion_db_id';
      process.env.OPENAI_API_KEY = 'sk-test-key';

      const manager = new ConfigManager();
      const result = manager.load();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MISSING_REQUIRED');
        expect(result.error.missingFields).toContain('GITHUB_REPOSITORIES');
      }
    });

    it('GITHUB_REPOSITORIESが未設定の場合にエラーを返す', () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token';
      process.env.TOGGL_API_TOKEN = 'toggl_test_token';
      process.env.NOTION_TOKEN = 'secret_notion_token';
      process.env.NOTION_DATABASE_ID = 'notion_db_id';
      process.env.OPENAI_API_KEY = 'sk-test-key';
      // GITHUB_REPOSITORIES を設定しない

      const manager = new ConfigManager();
      const result = manager.load();

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.missingFields).toContain('GITHUB_REPOSITORIES');
      }
    });
  });

  describe('load - スケジュール設定', () => {
    it('SCHEDULE_TIMEZONE のオーバーライド', () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token';
      process.env.GITHUB_REPOSITORIES = 'owner/repo1';
      process.env.TOGGL_API_TOKEN = 'toggl_test_token';
      process.env.NOTION_TOKEN = 'secret_notion_token';
      process.env.NOTION_DATABASE_ID = 'notion_db_id';
      process.env.OPENAI_API_KEY = 'sk-test-key';
      process.env.SCHEDULE_TIMEZONE = 'US/Pacific';
      process.env.SCHEDULE_ENABLED = 'true';

      const manager = new ConfigManager();
      const result = manager.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.schedule.timezone).toBe('US/Pacific');
        expect(result.value.schedule.enabled).toBe(true);
      }
    });

    it('SCHEDULE_NOTIFICATION_URL が設定される', () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token';
      process.env.GITHUB_REPOSITORIES = 'owner/repo1';
      process.env.TOGGL_API_TOKEN = 'toggl_test_token';
      process.env.NOTION_TOKEN = 'secret_notion_token';
      process.env.NOTION_DATABASE_ID = 'notion_db_id';
      process.env.OPENAI_API_KEY = 'sk-test-key';
      process.env.SCHEDULE_NOTIFICATION_URL = 'https://hooks.slack.com/test';

      const manager = new ConfigManager();
      const result = manager.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.schedule.notificationUrl).toBe('https://hooks.slack.com/test');
      }
    });
  });

  describe('load - ログ設定', () => {
    it('LOG_FILE_PATH のオーバーライド', () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token';
      process.env.GITHUB_REPOSITORIES = 'owner/repo1';
      process.env.TOGGL_API_TOKEN = 'toggl_test_token';
      process.env.NOTION_TOKEN = 'secret_notion_token';
      process.env.NOTION_DATABASE_ID = 'notion_db_id';
      process.env.OPENAI_API_KEY = 'sk-test-key';
      process.env.LOG_FILE_PATH = '/var/log/reflection.log';
      process.env.LOG_MAX_FILES = '20';
      process.env.LOG_MAX_SIZE = '50MB';

      const manager = new ConfigManager();
      const result = manager.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.logging.logFilePath).toBe('/var/log/reflection.log');
        expect(result.value.logging.maxLogFiles).toBe(20);
        expect(result.value.logging.maxLogSize).toBe('50MB');
      }
    });

    it('無効なLOG_LEVELの場合デフォルト値を使用する', () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token';
      process.env.GITHUB_REPOSITORIES = 'owner/repo1';
      process.env.TOGGL_API_TOKEN = 'toggl_test_token';
      process.env.NOTION_TOKEN = 'secret_notion_token';
      process.env.NOTION_DATABASE_ID = 'notion_db_id';
      process.env.OPENAI_API_KEY = 'sk-test-key';
      process.env.LOG_LEVEL = 'invalid_level';

      const manager = new ConfigManager();
      const result = manager.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.logging.logLevel).toBe('info');
      }
    });
  });

  describe('load - 数値パース', () => {
    it('無効な数値文字列の場合はデフォルト値を使用する', () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token';
      process.env.GITHUB_REPOSITORIES = 'owner/repo1';
      process.env.TOGGL_API_TOKEN = 'toggl_test_token';
      process.env.NOTION_TOKEN = 'secret_notion_token';
      process.env.NOTION_DATABASE_ID = 'notion_db_id';
      process.env.OPENAI_API_KEY = 'sk-test-key';
      process.env.REFLECTION_DEFAULT_PERIOD_DAYS = 'not_a_number';
      process.env.TOGGL_WORKSPACE_ID = 'abc';

      const manager = new ConfigManager();
      const result = manager.load();

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.reflection.defaultPeriodDays).toBe(7);
        expect(result.value.toggl.workspaceId).toBeUndefined();
      }
    });
  });

  describe('validate - 不足フィールドの詳細', () => {
    it('全ての必須フィールドが不足している場合に全項目を返す', () => {
      const manager = new ConfigManager();
      const result = manager.validate({});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('MISSING_REQUIRED');
        expect(result.error.missingFields).toContain('github.token');
        expect(result.error.missingFields).toContain('github.repositories');
        expect(result.error.missingFields).toContain('toggl.apiToken');
        expect(result.error.missingFields).toContain('notion.token');
        expect(result.error.missingFields).toContain('notion.databaseId');
        expect(result.error.missingFields).toContain('openai.apiKey');
      }
    });

    it('validate時にデフォルト値を適用する', () => {
      const manager = new ConfigManager();
      const result = manager.validate({
        github: { token: 'test', repositories: ['repo'] },
        toggl: { apiToken: 'test' },
        notion: { token: 'test', databaseId: 'test' },
        openai: { apiKey: 'test' },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.openai.model).toBe('gpt-4o');
        expect(result.value.reflection.defaultPeriodDays).toBe(7);
        expect(result.value.schedule.cronExpression).toBe('0 19 * * 0');
        expect(result.value.schedule.timezone).toBe('Asia/Tokyo');
        expect(result.value.logging.logLevel).toBe('info');
        expect(result.value.logging.maxLogFiles).toBe(10);
      }
    });

    it('空のリポジトリリストでバリデーションエラーを返す', () => {
      const manager = new ConfigManager();
      const result = manager.validate({
        github: { token: 'test', repositories: [] },
        toggl: { apiToken: 'test' },
        notion: { token: 'test', databaseId: 'test' },
        openai: { apiKey: 'test' },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.missingFields).toContain('github.repositories');
      }
    });
  });
});
