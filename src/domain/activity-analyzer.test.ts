import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivityAnalyzer } from './activity-analyzer.js';
import { ok, err } from '../types/result.js';
import type { IntegratedData, CommitData, TimeEntryData, DailySummary, ProjectSummary } from './data-integrator.js';
import type { KPTSuggestions, OpenAIError } from '../infrastructure/clients/openai-client.js';

/**
 * ActivityAnalyzer テスト
 * Task 3.2: 活動分析機能のテスト
 */

// Mock OpenAI client
const createMockOpenAIClient = () => ({
  generateSummary: vi.fn(),
  generateKPTSuggestions: vi.fn(),
});

// Test data helpers
const createMockIntegratedData = (): IntegratedData => ({
  dateRange: {
    start: new Date('2026-01-27T00:00:00Z'),
    end: new Date('2026-02-02T23:59:59Z'),
  },
  commits: [
    {
      sha: 'abc123',
      message: 'feat: add feature A',
      authorDate: new Date('2026-01-28T10:00:00Z'),
      repository: 'owner/repo1',
      filesChanged: 60,
      additions: 50,
      deletions: 10,
    },
    {
      sha: 'def456',
      message: 'fix: bug fix B',
      authorDate: new Date('2026-01-29T14:00:00Z'),
      repository: 'owner/repo1',
      filesChanged: 8,
      additions: 5,
      deletions: 3,
    },
    {
      sha: 'ghi789',
      message: 'docs: update readme',
      authorDate: new Date('2026-01-30T09:00:00Z'),
      repository: 'owner/repo2',
      filesChanged: 2,
      additions: 10,
      deletions: 0,
    },
  ] as CommitData[],
  timeEntries: [
    {
      id: 1,
      description: 'Feature A development',
      projectName: 'Project Alpha',
      startTime: new Date('2026-01-28T09:00:00Z'),
      endTime: new Date('2026-01-28T12:00:00Z'),
      durationSeconds: 10800,
      tags: ['dev'],
    },
    {
      id: 2,
      description: 'Code review',
      projectName: 'Project Alpha',
      startTime: new Date('2026-01-29T13:00:00Z'),
      endTime: new Date('2026-01-29T15:00:00Z'),
      durationSeconds: 7200,
      tags: ['review'],
    },
    {
      id: 3,
      description: 'Design meeting',
      projectName: 'Project Beta',
      startTime: new Date('2026-01-30T10:00:00Z'),
      endTime: new Date('2026-01-30T11:30:00Z'),
      durationSeconds: 5400,
      tags: ['meeting'],
    },
  ] as TimeEntryData[],
  dailySummaries: [
    { date: new Date('2026-01-28'), commitCount: 1, workHours: 3.0, projects: ['owner/repo1', 'Project Alpha'] },
    { date: new Date('2026-01-29'), commitCount: 1, workHours: 2.0, projects: ['owner/repo1', 'Project Alpha'] },
    { date: new Date('2026-01-30'), commitCount: 1, workHours: 1.5, projects: ['owner/repo2', 'Project Beta'] },
  ] as DailySummary[],
  projectSummaries: [
    { projectName: 'owner/repo1', totalCommits: 2, totalWorkHours: 0 },
    { projectName: 'owner/repo2', totalCommits: 1, totalWorkHours: 0 },
    { projectName: 'Project Alpha', totalCommits: 0, totalWorkHours: 5.0 },
    { projectName: 'Project Beta', totalCommits: 0, totalWorkHours: 1.5 },
  ] as ProjectSummary[],
  warnings: [],
});

const createEmptyIntegratedData = (): IntegratedData => ({
  dateRange: {
    start: new Date('2026-01-27T00:00:00Z'),
    end: new Date('2026-02-02T23:59:59Z'),
  },
  commits: [],
  timeEntries: [],
  dailySummaries: [],
  projectSummaries: [],
  warnings: [
    { type: 'NO_COMMITS', message: '該当期間のコミットはありません' },
    { type: 'NO_TIME_ENTRIES', message: '該当期間の打刻データはありません' },
  ],
});

describe('ActivityAnalyzer', () => {
  let mockOpenAIClient: ReturnType<typeof createMockOpenAIClient>;
  let analyzer: ActivityAnalyzer;

  beforeEach(() => {
    mockOpenAIClient = createMockOpenAIClient();
    analyzer = new ActivityAnalyzer(mockOpenAIClient);
  });

  describe('analyze', () => {
    it('should generate analysis with AI when OpenAI succeeds', async () => {
      const data = createMockIntegratedData();

      mockOpenAIClient.generateSummary.mockResolvedValue(
        ok('今週は3つのコミットと6.5時間の作業を実施しました。')
      );
      mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
        ok({
          keep: ['継続的なコミット活動'],
          problem: ['作業時間が短い日がある'],
          tryItems: ['作業時間を均等に分配する'],
        } as KPTSuggestions)
      );

      const result = await analyzer.analyze(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.aiEnabled).toBe(true);
        expect(result.value.weekSummary).toBe('今週は3つのコミットと6.5時間の作業を実施しました。');
        expect(result.value.kptSuggestions.keep.length).toBeGreaterThan(0);
        expect(result.value.kptSuggestions.problem.length).toBeGreaterThan(0);
        expect(result.value.kptSuggestions.tryItems.length).toBeGreaterThan(0);
      }
    });

    it('should generate daily analyses', async () => {
      const data = createMockIntegratedData();

      mockOpenAIClient.generateSummary.mockResolvedValue(ok('サマリー'));
      mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
        ok({ keep: ['test'], problem: ['test'], tryItems: ['test'] })
      );

      const result = await analyzer.analyze(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.dailySummaries.length).toBe(3);
        expect(result.value.dailySummaries[0].highlights.length).toBeGreaterThan(0);
      }
    });

    it('should generate insights from data', async () => {
      const data = createMockIntegratedData();

      mockOpenAIClient.generateSummary.mockResolvedValue(ok('サマリー'));
      mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
        ok({ keep: ['test'], problem: ['test'], tryItems: ['test'] })
      );

      const result = await analyzer.analyze(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.insights.length).toBeGreaterThan(0);
      }
    });

    it('should fallback to basic summary when OpenAI summary fails', async () => {
      const data = createMockIntegratedData();

      mockOpenAIClient.generateSummary.mockResolvedValue(
        err({ type: 'SERVICE_UNAVAILABLE', message: 'API down' } as OpenAIError)
      );
      mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
        err({ type: 'SERVICE_UNAVAILABLE', message: 'API down' } as OpenAIError)
      );

      const result = await analyzer.analyze(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.aiEnabled).toBe(false);
        expect(result.value.weekSummary.length).toBeGreaterThan(0);
        expect(result.value.kptSuggestions.keep.length).toBeGreaterThan(0);
      }
    });

    it('should fallback KPT when only KPT generation fails', async () => {
      const data = createMockIntegratedData();

      mockOpenAIClient.generateSummary.mockResolvedValue(ok('AIサマリー'));
      mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
        err({ type: 'RATE_LIMITED', retryAfter: 60 } as OpenAIError)
      );

      const result = await analyzer.analyze(data);

      expect(result.success).toBe(true);
      if (result.success) {
        // Summary should be AI-generated
        expect(result.value.weekSummary).toBe('AIサマリー');
        // KPT should be fallback
        expect(result.value.kptSuggestions.keep.length).toBeGreaterThan(0);
        // aiEnabled should still be true because summary succeeded
        expect(result.value.aiEnabled).toBe(true);
      }
    });

    it('should handle empty data gracefully', async () => {
      const data = createEmptyIntegratedData();

      mockOpenAIClient.generateSummary.mockResolvedValue(ok('データなし期間'));
      mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
        ok({ keep: ['test'], problem: ['test'], tryItems: ['test'] })
      );

      const result = await analyzer.analyze(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.dailySummaries.length).toBe(0);
        expect(result.value.weekSummary.length).toBeGreaterThan(0);
      }
    });

    it('should generate activity trend with project distribution', async () => {
      const data = createMockIntegratedData();

      mockOpenAIClient.generateSummary.mockResolvedValue(ok('サマリー'));
      mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
        ok({ keep: ['test'], problem: ['test'], tryItems: ['test'] })
      );

      const result = await analyzer.analyze(data);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.activityTrend).toBeDefined();
        if (result.value.activityTrend) {
          expect(result.value.activityTrend.projectDistribution.length).toBeGreaterThan(0);
          // Check percentages sum to approximately 100
          const totalPercentage = result.value.activityTrend.projectDistribution.reduce(
            (sum, p) => sum + p.percentage,
            0
          );
          expect(totalPercentage).toBeCloseTo(100, 0);
        }
      }
    });

    it('should pass correct data format to OpenAI client', async () => {
      const data = createMockIntegratedData();

      mockOpenAIClient.generateSummary.mockResolvedValue(ok('サマリー'));
      mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
        ok({ keep: ['test'], problem: ['test'], tryItems: ['test'] })
      );

      await analyzer.analyze(data);

      // Verify generateSummary was called with correct format
      expect(mockOpenAIClient.generateSummary).toHaveBeenCalledTimes(1);
      const summaryInput = mockOpenAIClient.generateSummary.mock.calls[0][0];
      expect(summaryInput.commits.length).toBe(3);
      expect(summaryInput.timeEntries.length).toBe(3);
      expect(summaryInput.period).toBeDefined();

      // Verify generateKPTSuggestions was called
      expect(mockOpenAIClient.generateKPTSuggestions).toHaveBeenCalledTimes(1);
      const kptInput = mockOpenAIClient.generateKPTSuggestions.mock.calls[0][0];
      expect(kptInput.weekSummary).toBe('サマリー');
      expect(kptInput.highlights.length).toBeGreaterThan(0);
    });

    it('should generate basic summary with statistics on fallback', async () => {
      const data = createMockIntegratedData();

      mockOpenAIClient.generateSummary.mockResolvedValue(
        err({ type: 'SERVICE_UNAVAILABLE', message: 'API down' } as OpenAIError)
      );
      mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
        err({ type: 'SERVICE_UNAVAILABLE', message: 'API down' } as OpenAIError)
      );

      const result = await analyzer.analyze(data);

      expect(result.success).toBe(true);
      if (result.success) {
        // Basic summary should include statistics
        expect(result.value.weekSummary).toContain('3'); // commit count
        expect(result.value.weekSummary).toContain('6.5'); // work hours
      }
    });

    it('should include previous try items in KPT input when provided', async () => {
      const data = createMockIntegratedData();
      const previousTryItems = ['前週のTry1', '前週のTry2'];

      mockOpenAIClient.generateSummary.mockResolvedValue(ok('サマリー'));
      mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
        ok({ keep: ['test'], problem: ['test'], tryItems: ['test'] })
      );

      await analyzer.analyze(data, previousTryItems);

      const kptInput = mockOpenAIClient.generateKPTSuggestions.mock.calls[0][0];
      expect(kptInput.previousTryItems).toEqual(previousTryItems);
    });
  });
});
