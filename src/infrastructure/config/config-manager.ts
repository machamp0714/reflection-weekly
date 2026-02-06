import { config as dotenvConfig } from 'dotenv';
import { Result, ok, err } from '../../types/result.js';

// Load .env file
dotenvConfig();

/**
 * Configuration error type
 */
export interface ConfigError {
  readonly type: 'MISSING_REQUIRED';
  readonly missingFields: readonly string[];
}

/**
 * GitHub configuration
 */
export interface GitHubConfig {
  readonly token: string;
  readonly repositories: readonly string[];
  readonly username?: string;
}

/**
 * Toggl configuration
 */
export interface TogglConfig {
  readonly apiToken: string;
  readonly workspaceId?: number;
}

/**
 * Notion configuration
 */
export interface NotionConfig {
  readonly token: string;
  readonly databaseId: string;
}

/**
 * OpenAI configuration
 */
export interface OpenAIConfig {
  readonly apiKey: string;
  readonly model: string;
}

/**
 * Reflection configuration
 */
export interface ReflectionConfig {
  readonly defaultPeriodDays: number;
}

/**
 * Schedule configuration
 */
export interface ScheduleConfig {
  readonly cronExpression: string;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly notificationUrl?: string;
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  readonly logFilePath: string;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  readonly maxLogFiles: number;
  readonly maxLogSize: string;
}

/**
 * Complete application configuration
 */
export interface AppConfig {
  readonly github: GitHubConfig;
  readonly toggl: TogglConfig;
  readonly notion: NotionConfig;
  readonly openai: OpenAIConfig;
  readonly reflection: ReflectionConfig;
  readonly schedule: ScheduleConfig;
  readonly logging: LoggingConfig;
}

/**
 * Partial configuration for validation
 */
export type PartialAppConfig = {
  github?: Partial<GitHubConfig>;
  toggl?: Partial<TogglConfig>;
  notion?: Partial<NotionConfig>;
  openai?: Partial<OpenAIConfig>;
  reflection?: Partial<ReflectionConfig>;
  schedule?: Partial<ScheduleConfig>;
  logging?: Partial<LoggingConfig>;
};

/**
 * Configuration Manager
 * Handles loading and validating application configuration from environment variables
 */
export class ConfigManager {
  private readonly defaultConfig: Omit<AppConfig, 'github' | 'toggl' | 'notion' | 'openai'> & {
    openai: { model: string };
  } = {
    openai: {
      model: 'gpt-4o',
    },
    reflection: {
      defaultPeriodDays: 7,
    },
    schedule: {
      cronExpression: '0 19 * * 0',
      timezone: 'Asia/Tokyo',
      enabled: false,
    },
    logging: {
      logFilePath: '~/.reflection-weekly/logs/execution.log',
      logLevel: 'info',
      maxLogFiles: 10,
      maxLogSize: '10MB',
    },
  };

  private readonly requiredEnvVars = [
    'GITHUB_TOKEN',
    'TOGGL_API_TOKEN',
    'NOTION_TOKEN',
    'NOTION_DATABASE_ID',
    'OPENAI_API_KEY',
  ] as const;

  /**
   * Load configuration from environment variables
   */
  load(): Result<AppConfig, ConfigError> {
    const missingFields: string[] = [];

    // Check required fields
    for (const envVar of this.requiredEnvVars) {
      if (!process.env[envVar]) {
        missingFields.push(envVar);
      }
    }

    // Check if repositories are configured (required)
    const repositories = this.parseRepositories(process.env.GITHUB_REPOSITORIES);
    if (repositories.length === 0) {
      missingFields.push('GITHUB_REPOSITORIES');
    }

    if (missingFields.length > 0) {
      return err({
        type: 'MISSING_REQUIRED',
        missingFields,
      });
    }

    const config: AppConfig = {
      github: {
        token: process.env.GITHUB_TOKEN!,
        repositories,
        username: process.env.GITHUB_USERNAME,
      },
      toggl: {
        apiToken: process.env.TOGGL_API_TOKEN!,
        workspaceId: this.parseNumber(process.env.TOGGL_WORKSPACE_ID),
      },
      notion: {
        token: process.env.NOTION_TOKEN!,
        databaseId: process.env.NOTION_DATABASE_ID!,
      },
      openai: {
        apiKey: process.env.OPENAI_API_KEY!,
        model: process.env.OPENAI_MODEL || this.defaultConfig.openai.model,
      },
      reflection: {
        defaultPeriodDays:
          this.parseNumber(process.env.REFLECTION_DEFAULT_PERIOD_DAYS) ||
          this.defaultConfig.reflection.defaultPeriodDays,
      },
      schedule: {
        cronExpression: process.env.SCHEDULE_CRON || this.defaultConfig.schedule.cronExpression,
        timezone: process.env.SCHEDULE_TIMEZONE || this.defaultConfig.schedule.timezone,
        enabled: this.parseBoolean(process.env.SCHEDULE_ENABLED) || this.defaultConfig.schedule.enabled,
        notificationUrl: process.env.SCHEDULE_NOTIFICATION_URL,
      },
      logging: {
        logFilePath: process.env.LOG_FILE_PATH || this.defaultConfig.logging.logFilePath,
        logLevel: this.parseLogLevel(process.env.LOG_LEVEL) || this.defaultConfig.logging.logLevel,
        maxLogFiles:
          this.parseNumber(process.env.LOG_MAX_FILES) || this.defaultConfig.logging.maxLogFiles,
        maxLogSize: process.env.LOG_MAX_SIZE || this.defaultConfig.logging.maxLogSize,
      },
    };

    return ok(config);
  }

  /**
   * Validate a partial configuration
   */
  validate(partialConfig: PartialAppConfig): Result<AppConfig, ConfigError> {
    const missingFields: string[] = [];

    // Check required fields
    if (!partialConfig.github?.token) {
      missingFields.push('github.token');
    }
    if (!partialConfig.github?.repositories || partialConfig.github.repositories.length === 0) {
      missingFields.push('github.repositories');
    }
    if (!partialConfig.toggl?.apiToken) {
      missingFields.push('toggl.apiToken');
    }
    if (!partialConfig.notion?.token) {
      missingFields.push('notion.token');
    }
    if (!partialConfig.notion?.databaseId) {
      missingFields.push('notion.databaseId');
    }
    if (!partialConfig.openai?.apiKey) {
      missingFields.push('openai.apiKey');
    }

    if (missingFields.length > 0) {
      return err({
        type: 'MISSING_REQUIRED',
        missingFields,
      });
    }

    // Build complete config with defaults
    const config: AppConfig = {
      github: {
        token: partialConfig.github!.token!,
        repositories: partialConfig.github!.repositories!,
        username: partialConfig.github?.username,
      },
      toggl: {
        apiToken: partialConfig.toggl!.apiToken!,
        workspaceId: partialConfig.toggl?.workspaceId,
      },
      notion: {
        token: partialConfig.notion!.token!,
        databaseId: partialConfig.notion!.databaseId!,
      },
      openai: {
        apiKey: partialConfig.openai!.apiKey!,
        model: partialConfig.openai?.model || this.defaultConfig.openai.model,
      },
      reflection: {
        defaultPeriodDays:
          partialConfig.reflection?.defaultPeriodDays ||
          this.defaultConfig.reflection.defaultPeriodDays,
      },
      schedule: {
        cronExpression:
          partialConfig.schedule?.cronExpression || this.defaultConfig.schedule.cronExpression,
        timezone: partialConfig.schedule?.timezone || this.defaultConfig.schedule.timezone,
        enabled: partialConfig.schedule?.enabled ?? this.defaultConfig.schedule.enabled,
        notificationUrl: partialConfig.schedule?.notificationUrl,
      },
      logging: {
        logFilePath: partialConfig.logging?.logFilePath || this.defaultConfig.logging.logFilePath,
        logLevel: partialConfig.logging?.logLevel || this.defaultConfig.logging.logLevel,
        maxLogFiles: partialConfig.logging?.maxLogFiles || this.defaultConfig.logging.maxLogFiles,
        maxLogSize: partialConfig.logging?.maxLogSize || this.defaultConfig.logging.maxLogSize,
      },
    };

    return ok(config);
  }

  /**
   * Mask sensitive data in config for safe logging
   */
  maskSensitiveData(config: AppConfig): AppConfig {
    return {
      ...config,
      github: {
        ...config.github,
        token: this.maskToken(config.github.token),
      },
      toggl: {
        ...config.toggl,
        apiToken: this.maskToken(config.toggl.apiToken),
      },
      notion: {
        ...config.notion,
        token: this.maskToken(config.notion.token),
      },
      openai: {
        ...config.openai,
        apiKey: this.maskToken(config.openai.apiKey),
      },
    };
  }

  private maskToken(token: string): string {
    if (token.length <= 6) {
      return '***';
    }
    // Show first 4 characters (including common prefixes like 'ghp_', 'sk-')
    // then mask the rest
    const prefixLength = token.includes('_') || token.includes('-') ? 4 : 3;
    return token.substring(0, prefixLength) + '***';
  }

  private parseRepositories(value: string | undefined): readonly string[] {
    if (!value) {
      return [];
    }
    return value
      .split(',')
      .map((repo) => repo.trim())
      .filter((repo) => repo.length > 0);
  }

  private parseNumber(value: string | undefined): number | undefined {
    if (!value) {
      return undefined;
    }
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? undefined : parsed;
  }

  private parseBoolean(value: string | undefined): boolean | undefined {
    if (!value) {
      return undefined;
    }
    return value.toLowerCase() === 'true';
  }

  private parseLogLevel(value: string | undefined): 'debug' | 'info' | 'warn' | 'error' | undefined {
    if (!value) {
      return undefined;
    }
    const level = value.toLowerCase();
    if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
      return level;
    }
    return undefined;
  }
}
