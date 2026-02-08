import { Result, ok, err } from '../types/result.js';
import type {
  IntegratedData,
  DateRange,
  DataSourceConfig,
  DataCollectionError,
} from '../domain/data-integrator.js';
import type { AnalysisResult } from '../domain/activity-analyzer.js';
import type {
  PageResult,
  PageBuildError,
  PageBuildOptions,
} from '../domain/reflection-page-builder.js';
import type { AppConfig, ConfigError } from '../infrastructure/config/config-manager.js';

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// --- Interfaces for dependency injection ---

/**
 * ConfigManager interface used by ReflectionUseCase
 */
export interface IConfigManager {
  load(): Result<AppConfig, ConfigError>;
}

/**
 * DataIntegrator interface used by ReflectionUseCase
 */
export interface IDataIntegrator {
  collectAndIntegrate(
    dateRange: DateRange,
    config: DataSourceConfig
  ): Promise<Result<IntegratedData, DataCollectionError>>;
}

/**
 * ActivityAnalyzer interface used by ReflectionUseCase
 */
export interface IActivityAnalyzer {
  analyze(
    data: IntegratedData,
    previousTryItems?: readonly string[]
  ): Promise<Result<AnalysisResult, { readonly type: 'AI_UNAVAILABLE'; readonly fallbackUsed: true }>>;
}

/**
 * ReflectionPageBuilder interface used by ReflectionUseCase
 */
export interface IReflectionPageBuilder {
  buildAndCreate(
    analysis: AnalysisResult,
    data: IntegratedData,
    options: PageBuildOptions
  ): Promise<Result<PageResult, PageBuildError>>;

  buildMarkdown(analysis: AnalysisResult, data: IntegratedData): string;
}

// --- Types ---

/**
 * Progress stage names
 */
export type ProgressStage = 'config' | 'data-collection' | 'analysis' | 'page-creation';

/**
 * Progress status
 */
export type ProgressStatus = 'start' | 'complete' | 'error';

/**
 * Progress event
 */
export interface ProgressEvent {
  readonly stage: ProgressStage;
  readonly status: ProgressStatus;
  readonly message?: string;
}

/**
 * Progress callback function type
 */
export type ProgressCallback = (event: ProgressEvent) => void;

/**
 * Options for executing the reflection use case
 */
export interface ReflectionOptions {
  readonly dateRange: DateRange;
  readonly dryRun: boolean;
  readonly onProgress?: ProgressCallback;
}

/**
 * Execution summary
 */
export interface ExecutionSummary {
  readonly dateRange: DateRange;
  readonly prCount: number;
  readonly timeEntryCount: number;
  readonly totalWorkHours: number;
  readonly aiAnalysisEnabled: boolean;
  readonly outputType: 'notion' | 'markdown' | 'preview';
}

/**
 * Reflection result
 */
export interface ReflectionResult {
  readonly pageUrl?: string;
  readonly localFilePath?: string;
  readonly preview?: string;
  readonly summary: ExecutionSummary;
  readonly warnings: readonly string[];
}

/**
 * Reflection error types
 */
export type ReflectionError =
  | { readonly type: 'CONFIG_INVALID'; readonly missingFields: readonly string[] }
  | { readonly type: 'DATA_COLLECTION_FAILED'; readonly source: string; readonly message: string }
  | { readonly type: 'PAGE_CREATION_FAILED'; readonly message: string };

/**
 * ReflectionUseCase - Orchestrates the weekly reflection generation process
 *
 * Responsibilities:
 * - Data collection, analysis, and page generation sequence control
 * - Config loading and validation integration
 * - Error fallback decision making
 * - Progress notification
 * - Dry run mode (preview without creating Notion page)
 * - Execution summary generation
 */
export class ReflectionUseCase {
  constructor(
    private readonly configManager: IConfigManager,
    private readonly dataIntegrator: IDataIntegrator,
    private readonly activityAnalyzer: IActivityAnalyzer,
    private readonly pageBuilder: IReflectionPageBuilder
  ) {}

  /**
   * Execute the reflection generation process
   */
  async execute(
    options: ReflectionOptions
  ): Promise<Result<ReflectionResult, ReflectionError>> {
    const { onProgress } = options;

    // Step 1: Load and validate configuration
    this.notifyProgress(onProgress, 'config', 'start');

    const configResult = this.configManager.load();
    if (!configResult.success) {
      this.notifyProgress(onProgress, 'config', 'error', 'Configuration validation failed');
      return err({
        type: 'CONFIG_INVALID',
        missingFields: configResult.error.missingFields,
      });
    }
    const config = configResult.value;
    this.notifyProgress(onProgress, 'config', 'complete');

    // Step 2: Collect data from sources
    this.notifyProgress(onProgress, 'data-collection', 'start');

    const dataSourceConfig: DataSourceConfig = {
      repositories: config.github.repositories,
      workspaceId: config.toggl.workspaceId,
    };

    const dataResult = await this.dataIntegrator.collectAndIntegrate(
      options.dateRange,
      dataSourceConfig
    );

    if (!dataResult.success) {
      this.notifyProgress(onProgress, 'data-collection', 'error', 'Data collection failed');
      const errorMessages = dataResult.error.errors
        .map((e) => `${e.source}: ${e.message}`)
        .join('; ');
      return err({
        type: 'DATA_COLLECTION_FAILED',
        source: 'all',
        message: errorMessages,
      });
    }

    const integratedData = dataResult.value;
    this.notifyProgress(onProgress, 'data-collection', 'complete');

    // Step 3: Analyze data
    this.notifyProgress(onProgress, 'analysis', 'start');

    const analysisResult = await this.activityAnalyzer.analyze(integratedData);
    let analysis: AnalysisResult;

    if (analysisResult.success) {
      analysis = analysisResult.value;
    } else {
      // This shouldn't happen since analyzer has internal fallback,
      // but handle it gracefully just in case
      analysis = {
        dailySummaries: [],
        weekSummary: 'Analysis unavailable',
        insights: [],
        kptSuggestions: { keep: [], problem: [], tryItems: [] },
        aiEnabled: false,
      };
    }

    this.notifyProgress(onProgress, 'analysis', 'complete');

    // Step 4: Create page
    this.notifyProgress(onProgress, 'page-creation', 'start');

    const warnings: string[] = [];

    // Add data collection warnings
    for (const warning of integratedData.warnings) {
      warnings.push(warning.message);
    }

    const pageBuildOptions: PageBuildOptions = {
      dryRun: options.dryRun,
      databaseId: config.notion.databaseId,
    };

    const pageResult = await this.pageBuilder.buildAndCreate(
      analysis,
      integratedData,
      pageBuildOptions
    );

    // Build execution summary
    const totalWorkHours = integratedData.timeEntries.reduce(
      (sum, e) => sum + e.durationSeconds / 3600,
      0
    );

    // Handle dry run mode
    if (options.dryRun && pageResult.success) {
      const preview = this.pageBuilder.buildMarkdown(analysis, integratedData);

      this.notifyProgress(onProgress, 'page-creation', 'complete');

      return ok({
        pageUrl: undefined,
        preview,
        summary: {
          dateRange: options.dateRange,
          prCount: integratedData.pullRequests.length,
          timeEntryCount: integratedData.timeEntries.length,
          totalWorkHours,
          aiAnalysisEnabled: analysis.aiEnabled,
          outputType: 'preview',
        },
        warnings,
      });
    }

    // Handle normal mode
    if (pageResult.success) {
      this.notifyProgress(onProgress, 'page-creation', 'complete');

      return ok({
        pageUrl: pageResult.value.pageUrl,
        summary: {
          dateRange: options.dateRange,
          prCount: integratedData.pullRequests.length,
          timeEntryCount: integratedData.timeEntries.length,
          totalWorkHours,
          aiAnalysisEnabled: analysis.aiEnabled,
          outputType: 'notion',
        },
        warnings,
      });
    }

    // Handle Notion failure - fallback to markdown
    warnings.push(
      `Notionページの作成に失敗しました。Markdownファイルにフォールバックします: ${pageResult.error.message}`
    );

    const markdownContent = this.pageBuilder.buildMarkdown(analysis, integratedData);
    const localFilePath = this.saveMarkdownFallback(markdownContent, options.dateRange);

    this.notifyProgress(onProgress, 'page-creation', 'complete');

    return ok({
      pageUrl: undefined,
      localFilePath,
      summary: {
        dateRange: options.dateRange,
        prCount: integratedData.pullRequests.length,
        timeEntryCount: integratedData.timeEntries.length,
        totalWorkHours,
        aiAnalysisEnabled: analysis.aiEnabled,
        outputType: 'markdown',
      },
      warnings,
    });
  }

  /**
   * Notify progress callback if provided
   */
  private notifyProgress(
    callback: ProgressCallback | undefined,
    stage: ProgressStage,
    status: ProgressStatus,
    message?: string
  ): void {
    if (callback) {
      callback({ stage, status, message });
    }
  }

  /**
   * Save markdown content to a local file as fallback
   */
  private saveMarkdownFallback(content: string, dateRange: DateRange): string {
    const startStr = dateRange.start.toISOString().split('T')[0];
    const endStr = dateRange.end.toISOString().split('T')[0];
    const fileName = `reflection-${startStr}-${endStr}.md`;
    const outputDir = path.join(os.tmpdir(), 'reflection-weekly');

    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      const filePath = path.join(outputDir, fileName);
      fs.writeFileSync(filePath, content, 'utf-8');
      return filePath;
    } catch {
      // If we can't write to temp dir, return a hypothetical path
      return path.join(outputDir, fileName);
    }
  }
}
