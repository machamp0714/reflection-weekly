import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ok, err } from '../types/result.js';
import type { Result } from '../types/result.js';
import type {
  IntegratedData,
  DateRange,
  DataSourceConfig,
  DataCollectionError,
  PullRequestData,
  TimeEntryData,
} from '../domain/data-integrator.js';
import type { AnalysisResult, AnalysisError } from '../domain/activity-analyzer.js';
import type { PageResult, PageBuildError, PageBuildOptions } from '../domain/reflection-page-builder.js';
import type { AppConfig, ConfigError } from '../infrastructure/config/config-manager.js';
import type { KPTSuggestions } from '../infrastructure/clients/openai-client.js';
import {
  ReflectionUseCase,
  type ReflectionOptions,
  type ReflectionResult,
  type ProgressCallback,
  type IConfigManager,
  type IDataIntegrator,
  type IActivityAnalyzer,
  type IReflectionPageBuilder,
} from './reflection-use-case.js';

// --- Test Helpers ---

function createMockConfig(): AppConfig {
  return {
    github: {
      token: 'ghp_test',
      repositories: ['owner/repo1', 'owner/repo2'],
      username: 'testuser',
    },
    toggl: {
      apiToken: 'toggl_test',
      workspaceId: 12345,
    },
    notion: {
      token: 'ntn_test',
      databaseId: 'db-123',
    },
    openai: {
      apiKey: 'sk-test',
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
}

function createMockDateRange(): DateRange {
  return {
    start: new Date('2026-01-27T00:00:00Z'),
    end: new Date('2026-02-02T23:59:59Z'),
  };
}

function createMockPullRequests(): PullRequestData[] {
  return [
    {
      number: 42,
      title: 'feat: add feature',
      description: 'This PR adds a feature.',
      createdAt: new Date('2026-01-28T10:00:00Z'),
      repository: 'owner/repo1',
      url: 'https://github.com/owner/repo1/pull/42',
      state: 'merged',
    },
    {
      number: 43,
      title: 'fix: bug fix',
      description: 'Fixes a bug.',
      createdAt: new Date('2026-01-29T14:00:00Z'),
      repository: 'owner/repo1',
      url: 'https://github.com/owner/repo1/pull/43',
      state: 'open',
    },
  ];
}

function createMockTimeEntries(): TimeEntryData[] {
  return [
    {
      id: 1,
      description: 'Development work',
      projectName: 'Project A',
      startTime: new Date('2026-01-28T09:00:00Z'),
      endTime: new Date('2026-01-28T17:00:00Z'),
      durationSeconds: 28800,
      tags: ['development'],
    },
  ];
}

function createMockIntegratedData(): IntegratedData {
  return {
    dateRange: createMockDateRange(),
    pullRequests: createMockPullRequests(),
    timeEntries: createMockTimeEntries(),
    dailySummaries: [
      {
        date: new Date('2026-01-28T00:00:00Z'),
        prCount: 1,
        workHours: 8,
        projects: ['owner/repo1', 'Project A'],
      },
      {
        date: new Date('2026-01-29T00:00:00Z'),
        prCount: 1,
        workHours: 0,
        projects: ['owner/repo1'],
      },
    ],
    projectSummaries: [
      { projectName: 'owner/repo1', totalPRs: 2, totalWorkHours: 0 },
      { projectName: 'Project A', totalPRs: 0, totalWorkHours: 8 },
    ],
    warnings: [],
  };
}

function createMockKPTSuggestions(): KPTSuggestions {
  return {
    keep: ['Keep coding daily'],
    problem: ['Long working hours'],
    tryItems: ['Take more breaks'],
  };
}

function createMockAnalysisResult(): AnalysisResult {
  return {
    dailySummaries: [
      {
        date: new Date('2026-01-28T00:00:00Z'),
        summary: 'Active development day',
        highlights: ['feat: add feature'],
      },
    ],
    weekSummary: 'Productive week with 2 PRs and 8h work',
    insights: ['Total PRs: 2', 'Total work hours: 8'],
    kptSuggestions: createMockKPTSuggestions(),
    aiEnabled: true,
  };
}

function createMockPageResult(): PageResult {
  return {
    pageUrl: 'https://notion.so/page-123',
    pageId: 'page-123',
    title: 'Week 5: 2026-01-27 - 2026-02-02',
  };
}

function createMockDependencies() {
  const configManager: IConfigManager = {
    load: vi.fn().mockReturnValue(ok(createMockConfig())),
  };

  const dataIntegrator: IDataIntegrator = {
    collectAndIntegrate: vi.fn().mockResolvedValue(ok(createMockIntegratedData())),
  };

  const activityAnalyzer: IActivityAnalyzer = {
    analyze: vi.fn().mockResolvedValue(ok(createMockAnalysisResult())),
  };

  const pageBuilder: IReflectionPageBuilder = {
    buildAndCreate: vi.fn().mockResolvedValue(ok(createMockPageResult())),
    buildMarkdown: vi.fn().mockReturnValue('# Week 5\n\nMarkdown content'),
  };

  return { configManager, dataIntegrator, activityAnalyzer, pageBuilder };
}

// --- Tests ---

describe('ReflectionUseCase', () => {
  let useCase: ReflectionUseCase;
  let deps: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    deps = createMockDependencies();
    useCase = new ReflectionUseCase(
      deps.configManager,
      deps.dataIntegrator,
      deps.activityAnalyzer,
      deps.pageBuilder
    );
  });

  describe('execute - normal flow', () => {
    it('should execute the full reflection flow successfully', async () => {
      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
      };

      const result = await useCase.execute(options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.pageUrl).toBe('https://notion.so/page-123');
        expect(result.value.summary).toBeDefined();
        expect(result.value.summary.prCount).toBe(2);
        expect(result.value.summary.timeEntryCount).toBe(1);
        expect(result.value.summary.totalWorkHours).toBeCloseTo(8);
        expect(result.value.summary.aiAnalysisEnabled).toBe(true);
        expect(result.value.summary.outputType).toBe('notion');
      }
    });

    it('should call config manager load first', async () => {
      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
      };

      await useCase.execute(options);

      expect(deps.configManager.load).toHaveBeenCalledTimes(1);
    });

    it('should call data integrator with correct parameters', async () => {
      const dateRange = createMockDateRange();
      const options: ReflectionOptions = {
        dateRange,
        dryRun: false,
      };

      await useCase.execute(options);

      expect(deps.dataIntegrator.collectAndIntegrate).toHaveBeenCalledWith(
        dateRange,
        expect.objectContaining({
          repositories: ['owner/repo1', 'owner/repo2'],
        })
      );
    });

    it('should call activity analyzer with integrated data', async () => {
      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
      };

      await useCase.execute(options);

      expect(deps.activityAnalyzer.analyze).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(deps.activityAnalyzer.analyze).mock.calls[0];
      expect(callArgs[0]).toHaveProperty('pullRequests');
      expect(callArgs[0]).toHaveProperty('timeEntries');
      expect(Array.isArray(callArgs[0].pullRequests)).toBe(true);
      expect(Array.isArray(callArgs[0].timeEntries)).toBe(true);
    });

    it('should call page builder with analysis result and data', async () => {
      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
      };

      await useCase.execute(options);

      expect(deps.pageBuilder.buildAndCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          weekSummary: expect.any(String),
          aiEnabled: true,
        }),
        expect.objectContaining({
          pullRequests: expect.any(Array),
        }),
        expect.objectContaining({
          dryRun: false,
          databaseId: 'db-123',
        })
      );
    });

    it('should include warnings from data collection in result', async () => {
      const integratedData = createMockIntegratedData();
      const dataWithWarnings: IntegratedData = {
        ...integratedData,
        warnings: [
          { type: 'NO_PULL_REQUESTS', message: 'No PRs found' },
        ],
      };
      vi.mocked(deps.dataIntegrator.collectAndIntegrate).mockResolvedValue(
        ok(dataWithWarnings)
      );

      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
      };

      const result = await useCase.execute(options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.warnings.length).toBeGreaterThan(0);
      }
    });
  });

  describe('execute - execution order', () => {
    it('should execute in order: config -> data collection -> analysis -> page building', async () => {
      const callOrder: string[] = [];

      vi.mocked(deps.configManager.load).mockImplementation(() => {
        callOrder.push('config');
        return ok(createMockConfig());
      });

      vi.mocked(deps.dataIntegrator.collectAndIntegrate).mockImplementation(async () => {
        callOrder.push('data');
        return ok(createMockIntegratedData());
      });

      vi.mocked(deps.activityAnalyzer.analyze).mockImplementation(async () => {
        callOrder.push('analysis');
        return ok(createMockAnalysisResult());
      });

      vi.mocked(deps.pageBuilder.buildAndCreate).mockImplementation(async () => {
        callOrder.push('page');
        return ok(createMockPageResult());
      });

      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
      };

      await useCase.execute(options);

      expect(callOrder).toEqual(['config', 'data', 'analysis', 'page']);
    });
  });

  describe('execute - config validation', () => {
    it('should return CONFIG_INVALID error when config is missing required fields', async () => {
      vi.mocked(deps.configManager.load).mockReturnValue(
        err({
          type: 'MISSING_REQUIRED' as const,
          missingFields: ['GITHUB_TOKEN', 'NOTION_DATABASE_ID'],
        })
      );

      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
      };

      const result = await useCase.execute(options);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('CONFIG_INVALID');
        expect(result.error).toHaveProperty('missingFields');
        if (result.error.type === 'CONFIG_INVALID') {
          expect(result.error.missingFields).toContain('GITHUB_TOKEN');
          expect(result.error.missingFields).toContain('NOTION_DATABASE_ID');
        }
      }
    });

    it('should not proceed to data collection when config is invalid', async () => {
      vi.mocked(deps.configManager.load).mockReturnValue(
        err({
          type: 'MISSING_REQUIRED' as const,
          missingFields: ['GITHUB_TOKEN'],
        })
      );

      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
      };

      await useCase.execute(options);

      expect(deps.dataIntegrator.collectAndIntegrate).not.toHaveBeenCalled();
    });
  });

  describe('execute - error handling and fallback', () => {
    it('should return DATA_COLLECTION_FAILED when all sources fail', async () => {
      vi.mocked(deps.dataIntegrator.collectAndIntegrate).mockResolvedValue(
        err({
          type: 'ALL_SOURCES_FAILED',
          errors: [
            { source: 'github', message: 'API error' },
            { source: 'toggl', message: 'Auth error' },
          ],
        })
      );

      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
      };

      const result = await useCase.execute(options);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('DATA_COLLECTION_FAILED');
      }
    });

    it('should fallback to markdown when page creation fails', async () => {
      vi.mocked(deps.pageBuilder.buildAndCreate).mockResolvedValue(
        err({
          type: 'NOTION_API_ERROR',
          message: 'Notion API unavailable',
        })
      );

      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
      };

      const result = await useCase.execute(options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.pageUrl).toBeUndefined();
        expect(result.value.localFilePath).toBeDefined();
        expect(result.value.summary.outputType).toBe('markdown');
        expect(result.value.warnings.length).toBeGreaterThan(0);
      }
    });

    it('should call buildMarkdown as fallback when Notion fails', async () => {
      vi.mocked(deps.pageBuilder.buildAndCreate).mockResolvedValue(
        err({
          type: 'NOTION_API_ERROR',
          message: 'Notion API unavailable',
        })
      );

      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
      };

      await useCase.execute(options);

      expect(deps.pageBuilder.buildMarkdown).toHaveBeenCalled();
    });

    it('should continue with analysis even when AI fallback is used', async () => {
      const analysisWithoutAI = createMockAnalysisResult();
      const noAIResult: AnalysisResult = {
        ...analysisWithoutAI,
        aiEnabled: false,
      };
      vi.mocked(deps.activityAnalyzer.analyze).mockResolvedValue(ok(noAIResult));

      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
      };

      const result = await useCase.execute(options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.summary.aiAnalysisEnabled).toBe(false);
      }
    });
  });

  describe('execute - dry run mode', () => {
    it('should pass dryRun flag to page builder', async () => {
      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: true,
      };

      await useCase.execute(options);

      expect(deps.pageBuilder.buildAndCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          dryRun: true,
        })
      );
    });

    it('should return markdown content in dry run mode for preview', async () => {
      const dryRunPageResult: PageResult = {
        pageUrl: undefined,
        pageId: undefined,
        title: 'Week 5: 2026-01-27 - 2026-02-02',
      };
      vi.mocked(deps.pageBuilder.buildAndCreate).mockResolvedValue(ok(dryRunPageResult));

      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: true,
      };

      const result = await useCase.execute(options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.pageUrl).toBeUndefined();
        expect(result.value.preview).toBeDefined();
        expect(result.value.summary.outputType).toBe('preview');
      }
    });

    it('should still collect and analyze data in dry run mode', async () => {
      const dryRunPageResult: PageResult = {
        pageUrl: undefined,
        pageId: undefined,
        title: 'Week 5: 2026-01-27 - 2026-02-02',
      };
      vi.mocked(deps.pageBuilder.buildAndCreate).mockResolvedValue(ok(dryRunPageResult));

      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: true,
      };

      await useCase.execute(options);

      expect(deps.dataIntegrator.collectAndIntegrate).toHaveBeenCalled();
      expect(deps.activityAnalyzer.analyze).toHaveBeenCalled();
      expect(deps.pageBuilder.buildAndCreate).toHaveBeenCalled();
    });
  });

  describe('execute - progress notification', () => {
    it('should notify progress at each stage', async () => {
      const progressCallback = vi.fn();

      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
        onProgress: progressCallback,
      };

      await useCase.execute(options);

      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'config', status: 'start' })
      );
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'data-collection', status: 'start' })
      );
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'analysis', status: 'start' })
      );
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'page-creation', status: 'start' })
      );
    });

    it('should notify completion for each stage', async () => {
      const progressCallback = vi.fn();

      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
        onProgress: progressCallback,
      };

      await useCase.execute(options);

      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'config', status: 'complete' })
      );
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'data-collection', status: 'complete' })
      );
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'analysis', status: 'complete' })
      );
      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'page-creation', status: 'complete' })
      );
    });

    it('should notify error when a stage fails', async () => {
      const progressCallback = vi.fn();

      vi.mocked(deps.configManager.load).mockReturnValue(
        err({
          type: 'MISSING_REQUIRED' as const,
          missingFields: ['GITHUB_TOKEN'],
        })
      );

      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
        onProgress: progressCallback,
      };

      await useCase.execute(options);

      expect(progressCallback).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'config', status: 'error' })
      );
    });

    it('should work without progress callback', async () => {
      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
      };

      // Should not throw
      const result = await useCase.execute(options);
      expect(result.success).toBe(true);
    });
  });

  describe('execute - execution summary', () => {
    it('should generate a correct execution summary', async () => {
      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
      };

      const result = await useCase.execute(options);

      expect(result.success).toBe(true);
      if (result.success) {
        const summary = result.value.summary;
        expect(summary.dateRange).toEqual(createMockDateRange());
        expect(summary.prCount).toBe(2);
        expect(summary.timeEntryCount).toBe(1);
        expect(summary.totalWorkHours).toBeCloseTo(8);
        expect(summary.aiAnalysisEnabled).toBe(true);
        expect(summary.outputType).toBe('notion');
      }
    });

    it('should generate summary with zero values when data is empty', async () => {
      const emptyData: IntegratedData = {
        dateRange: createMockDateRange(),
        pullRequests: [],
        timeEntries: [],
        dailySummaries: [],
        projectSummaries: [],
        warnings: [
          { type: 'NO_PULL_REQUESTS', message: 'No PRs' },
          { type: 'NO_TIME_ENTRIES', message: 'No time entries' },
        ],
      };
      vi.mocked(deps.dataIntegrator.collectAndIntegrate).mockResolvedValue(ok(emptyData));

      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
      };

      const result = await useCase.execute(options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.summary.prCount).toBe(0);
        expect(result.value.summary.timeEntryCount).toBe(0);
        expect(result.value.summary.totalWorkHours).toBe(0);
      }
    });
  });

  describe('execute - markdown fallback file writing', () => {
    it('should generate a valid local file path when Notion fails', async () => {
      vi.mocked(deps.pageBuilder.buildAndCreate).mockResolvedValue(
        err({
          type: 'NOTION_API_ERROR',
          message: 'Service unavailable',
        })
      );

      const options: ReflectionOptions = {
        dateRange: createMockDateRange(),
        dryRun: false,
      };

      const result = await useCase.execute(options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.localFilePath).toMatch(/reflection-.*\.md$/);
      }
    });
  });
});
