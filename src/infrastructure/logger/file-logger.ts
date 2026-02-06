import pino, { Logger } from 'pino';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Execution context for logging
 */
export interface ExecutionContext {
  readonly executionId: string;
  readonly scheduledTime: Date;
  readonly triggerType: 'scheduled' | 'manual';
}

/**
 * Success result for logging
 */
export interface ExecutionSuccessResult {
  readonly executionId: string;
  readonly duration: number;
  readonly pageUrl: string;
  readonly summary: {
    readonly commitCount: number;
    readonly workHours: number;
  };
}

/**
 * Error result for logging
 */
export interface ExecutionErrorResult {
  readonly executionId: string;
  readonly duration: number;
  readonly error: {
    readonly type: string;
    readonly message: string;
    readonly stack?: string;
  };
  readonly partialResult?: {
    readonly localFilePath?: string;
  };
}

/**
 * Log entry structure
 */
export interface LogEntry {
  readonly timestamp: Date;
  readonly level: 'info' | 'warn' | 'error' | 'debug';
  readonly executionId: string;
  readonly event: 'start' | 'success' | 'error';
  readonly details: Record<string, unknown>;
}

/**
 * Logger configuration options
 */
export interface FileLoggerOptions {
  readonly logFilePath: string;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * File Logger implementation using pino
 */
export class FileLogger {
  private readonly logger: Logger;
  private readonly logFilePath: string;
  private readonly logLevel: 'debug' | 'info' | 'warn' | 'error';

  // Patterns to mask in log output
  private readonly sensitivePatterns: RegExp[] = [
    /ghp_[a-zA-Z0-9]{10,}/g, // GitHub Personal Access Token
    /gho_[a-zA-Z0-9]{10,}/g, // GitHub OAuth Token
    /github_pat_[a-zA-Z0-9_]{10,}/g, // GitHub Fine-grained PAT
    /sk-[a-zA-Z0-9-]{8,}/g, // OpenAI API Key (various formats)
    /secret_[a-zA-Z0-9]{10,}/g, // Notion secret
    /[a-f0-9]{32,}/gi, // Generic long hex tokens (Toggl, etc.)
  ];

  constructor(options: FileLoggerOptions) {
    this.logFilePath = options.logFilePath;
    this.logLevel = options.logLevel;

    // Ensure directory exists
    const logDir = path.dirname(this.logFilePath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Create pino logger with file destination
    this.logger = pino(
      {
        level: this.logLevel,
        formatters: {
          level: (label) => ({ level: label }),
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      pino.destination({
        dest: this.logFilePath,
        sync: true, // Synchronous for reliable logging
      })
    );
  }

  /**
   * Log execution start
   */
  logExecutionStart(context: ExecutionContext): void {
    this.logger.info({
      event: 'start',
      executionId: context.executionId,
      scheduledTime: context.scheduledTime.toISOString(),
      triggerType: context.triggerType,
    });
  }

  /**
   * Log successful execution
   */
  logExecutionSuccess(result: ExecutionSuccessResult): void {
    this.logger.info({
      event: 'success',
      executionId: result.executionId,
      duration: result.duration,
      pageUrl: result.pageUrl,
      commitCount: result.summary.commitCount,
      workHours: result.summary.workHours,
    });
  }

  /**
   * Log error execution
   */
  logExecutionError(result: ExecutionErrorResult): void {
    this.logger.error({
      event: 'error',
      executionId: result.executionId,
      duration: result.duration,
      errorType: result.error.type,
      errorMessage: this.maskSensitiveData(result.error.message),
      errorStack: result.error.stack ? this.maskSensitiveData(result.error.stack) : undefined,
      localFilePath: result.partialResult?.localFilePath,
    });
  }

  /**
   * Log debug message
   */
  debug(executionId: string, details: Record<string, unknown>): void {
    this.logger.debug({
      executionId,
      ...details,
    });
  }

  /**
   * Log warning message
   */
  warn(executionId: string, message: string, details?: Record<string, unknown>): void {
    this.logger.warn({
      executionId,
      message: this.maskSensitiveData(message),
      ...details,
    });
  }

  /**
   * Get recent log entries
   */
  getRecentLogs(limit: number): readonly LogEntry[] {
    try {
      if (!fs.existsSync(this.logFilePath)) {
        return [];
      }

      const content = fs.readFileSync(this.logFilePath, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);

      // Parse JSON lines and convert to LogEntry format
      const entries: LogEntry[] = [];

      for (const line of lines.slice(-limit)) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          const entry: LogEntry = {
            timestamp: new Date(parsed.time as string),
            level: this.parseLevel(parsed.level as string),
            executionId: (parsed.executionId as string) || 'unknown',
            event: this.parseEvent(parsed.event as string | undefined),
            details: parsed,
          };
          entries.push(entry);
        } catch {
          // Skip malformed lines
        }
      }

      return entries.slice(-limit);
    } catch {
      return [];
    }
  }

  /**
   * Mask sensitive data in strings
   */
  private maskSensitiveData(text: string): string {
    let masked = text;
    for (const pattern of this.sensitivePatterns) {
      masked = masked.replace(pattern, (match) => {
        if (match.length <= 8) {
          return '***';
        }
        return match.substring(0, 4) + '***';
      });
    }
    return masked;
  }

  private parseLevel(level: string): 'info' | 'warn' | 'error' | 'debug' {
    switch (level) {
      case 'debug':
      case 'info':
      case 'warn':
      case 'error':
        return level;
      default:
        return 'info';
    }
  }

  private parseEvent(event: string | undefined): 'start' | 'success' | 'error' {
    switch (event) {
      case 'start':
      case 'success':
      case 'error':
        return event;
      default:
        return 'start';
    }
  }
}
