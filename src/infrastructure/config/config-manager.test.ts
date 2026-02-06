import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConfigManager, ConfigError, AppConfig } from './config-manager.js';

describe('ConfigManager', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
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
  });
});
