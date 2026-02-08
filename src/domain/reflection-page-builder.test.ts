import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReflectionPageBuilder } from './reflection-page-builder.js';
import { ok, err } from '../types/result.js';
import type { AnalysisResult } from './activity-analyzer.js';
import type { IntegratedData, PullRequestData, TimeEntryData, DailySummary, ProjectSummary } from './data-integrator.js';
import type { NotionPage, NotionError, NotionPageContent } from '../infrastructure/clients/notion-client.js';
import type { PageBuildOptions } from './reflection-page-builder.js';

/**
 * ReflectionPageBuilder テスト
 * Task 3.3: 振り返りページ構築機能のテスト
 */

// Mock Notion client
const createMockNotionClient = () => ({
  createPage: vi.fn(),
  queryDatabase: vi.fn(),
  getPage: vi.fn(),
});

// Test data helpers
const createMockAnalysisResult = (): AnalysisResult => ({
  dailySummaries: [
    {
      date: new Date('2026-01-28'),
      summary: '1件のPR / 3.0時間の作業',
      highlights: ['owner/repo1: feat: add feature A', 'Project Alpha: Feature A development (3.0h)'],
    },
    {
      date: new Date('2026-01-29'),
      summary: '1件のPR / 2.0時間の作業',
      highlights: ['owner/repo1: fix: bug fix B', 'Project Alpha: Code review (2.0h)'],
    },
  ],
  weekSummary: '今週は3つのPRと6.5時間の作業を実施しました。',
  insights: [
    '今週の総PR数: 3件',
    '今週の総作業時間: 6.5時間',
    '作業時間あたりのPR数: 0.46件/時間',
  ],
  kptSuggestions: {
    keep: ['継続的なPR活動', 'Toggl記録の習慣化'],
    problem: ['作業時間が短い日がある'],
    tryItems: ['作業時間を均等に分配する'],
  },
  activityTrend: {
    projectDistribution: [
      { projectName: 'Project Alpha', percentage: 65 },
      { projectName: 'Project Beta', percentage: 35 },
    ],
  },
  aiEnabled: true,
});

const createMockIntegratedData = (): IntegratedData => ({
  dateRange: {
    start: new Date('2026-01-27T00:00:00Z'),
    end: new Date('2026-02-02T23:59:59Z'),
  },
  pullRequests: [
    {
      number: 42,
      title: 'feat: add feature A',
      description: 'This PR adds feature A.',
      createdAt: new Date('2026-01-28T10:00:00Z'),
      repository: 'owner/repo1',
      url: 'https://github.com/owner/repo1/pull/42',
      state: 'merged',
    },
  ] as PullRequestData[],
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
  ] as TimeEntryData[],
  dailySummaries: [
    { date: new Date('2026-01-28'), prCount: 1, workHours: 3.0, projects: ['owner/repo1', 'Project Alpha'] },
  ] as DailySummary[],
  projectSummaries: [
    { projectName: 'owner/repo1', totalPRs: 1, totalWorkHours: 0 },
    { projectName: 'Project Alpha', totalPRs: 0, totalWorkHours: 3.0 },
  ] as ProjectSummary[],
  warnings: [],
});

const createMockPageBuildOptions = (): PageBuildOptions => ({
  dryRun: false,
  databaseId: 'test-database-id',
});

describe('ReflectionPageBuilder', () => {
  let mockNotionClient: ReturnType<typeof createMockNotionClient>;
  let builder: ReflectionPageBuilder;

  beforeEach(() => {
    mockNotionClient = createMockNotionClient();
    builder = new ReflectionPageBuilder(mockNotionClient);
  });

  describe('buildAndCreate', () => {
    it('should create a Notion page with correct structure', async () => {
      const analysis = createMockAnalysisResult();
      const data = createMockIntegratedData();
      const options = createMockPageBuildOptions();

      mockNotionClient.createPage.mockResolvedValue(
        ok({
          id: 'page-123',
          url: 'https://notion.so/page-123',
          createdTime: '2026-02-02T19:00:00Z',
          properties: {},
        } as NotionPage)
      );

      const result = await builder.buildAndCreate(analysis, data, options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.pageUrl).toBe('https://notion.so/page-123');
        expect(result.value.pageId).toBe('page-123');
        expect(result.value.title).toContain('2026-01-27');
        expect(result.value.title).toContain('2026-02-02');
      }
    });

    it('should generate title with week start and end dates', async () => {
      const analysis = createMockAnalysisResult();
      const data = createMockIntegratedData();
      const options = createMockPageBuildOptions();

      mockNotionClient.createPage.mockResolvedValue(
        ok({
          id: 'page-123',
          url: 'https://notion.so/page-123',
          createdTime: '2026-02-02T19:00:00Z',
          properties: {},
        } as NotionPage)
      );

      const result = await builder.buildAndCreate(analysis, data, options);

      expect(result.success).toBe(true);
      if (result.success) {
        // Title should contain week info
        expect(result.value.title).toMatch(/Week \d+/);
        expect(result.value.title).toContain('2026-01-27');
        expect(result.value.title).toContain('2026-02-02');
      }
    });

    it('should pass correct properties to Notion client', async () => {
      const analysis = createMockAnalysisResult();
      const data = createMockIntegratedData();
      const options = createMockPageBuildOptions();

      mockNotionClient.createPage.mockResolvedValue(
        ok({
          id: 'page-123',
          url: 'https://notion.so/page-123',
          createdTime: '2026-02-02T19:00:00Z',
          properties: {},
        } as NotionPage)
      );

      await builder.buildAndCreate(analysis, data, options);

      expect(mockNotionClient.createPage).toHaveBeenCalledTimes(1);
      const [content, databaseId] = mockNotionClient.createPage.mock.calls[0];

      expect(databaseId).toBe('test-database-id');
      expect(content.properties.weekNumber).toBeGreaterThan(0);
      expect(content.properties.tags).toContain('weekly-reflection');
      expect(content.properties.tags).toContain('auto-generated');
      expect(content.properties.prCount).toBe(1);
      expect(content.properties.workHours).toBeCloseTo(3.0, 1);
      expect(content.properties.aiEnabled).toBe(true);
    });

    it('should include all required sections in page content', async () => {
      const analysis = createMockAnalysisResult();
      const data = createMockIntegratedData();
      const options = createMockPageBuildOptions();

      mockNotionClient.createPage.mockResolvedValue(
        ok({
          id: 'page-123',
          url: 'https://notion.so/page-123',
          createdTime: '2026-02-02T19:00:00Z',
          properties: {},
        } as NotionPage)
      );

      await builder.buildAndCreate(analysis, data, options);

      const [content] = mockNotionClient.createPage.mock.calls[0] as [NotionPageContent, string];
      const blocks = content.blocks;

      // Should have heading blocks for main sections
      const headingContents = blocks
        .filter((b) => b.type === 'heading_1' || b.type === 'heading_2')
        .map((b) => ('content' in b ? b.content : ''));

      // Check all key sections are present
      expect(headingContents.some((h) => h.includes('サマリー') || h.includes('概要'))).toBe(true);
      expect(headingContents.some((h) => h.includes('GitHub') || h.includes('PR'))).toBe(true);
      expect(headingContents.some((h) => h.includes('Toggl') || h.includes('作業時間'))).toBe(true);
      expect(headingContents.some((h) => h.includes('Keep'))).toBe(true);
      expect(headingContents.some((h) => h.includes('Problem'))).toBe(true);
      expect(headingContents.some((h) => h.includes('Try'))).toBe(true);
    });

    it('should include KPT suggestions in page content', async () => {
      const analysis = createMockAnalysisResult();
      const data = createMockIntegratedData();
      const options = createMockPageBuildOptions();

      mockNotionClient.createPage.mockResolvedValue(
        ok({
          id: 'page-123',
          url: 'https://notion.so/page-123',
          createdTime: '2026-02-02T19:00:00Z',
          properties: {},
        } as NotionPage)
      );

      await builder.buildAndCreate(analysis, data, options);

      const [content] = mockNotionClient.createPage.mock.calls[0] as [NotionPageContent, string];
      const bulletItems = content.blocks
        .filter((b) => b.type === 'bulleted_list_item')
        .map((b) => ('content' in b ? b.content : ''));

      // KPT suggestions should appear
      expect(bulletItems.some((item) => item.includes('継続的なPR活動'))).toBe(true);
      expect(bulletItems.some((item) => item.includes('作業時間が短い日がある'))).toBe(true);
      expect(bulletItems.some((item) => item.includes('作業時間を均等に分配する'))).toBe(true);
    });

    it('should include previous Try items section when provided', async () => {
      const analysis = createMockAnalysisResult();
      const data = createMockIntegratedData();
      const options: PageBuildOptions = {
        dryRun: false,
        databaseId: 'test-database-id',
        previousTryItems: ['前週のTry1', '前週のTry2'],
      };

      mockNotionClient.createPage.mockResolvedValue(
        ok({
          id: 'page-123',
          url: 'https://notion.so/page-123',
          createdTime: '2026-02-02T19:00:00Z',
          properties: {},
        } as NotionPage)
      );

      await builder.buildAndCreate(analysis, data, options);

      const [content] = mockNotionClient.createPage.mock.calls[0] as [NotionPageContent, string];
      const allContent = content.blocks
        .filter((b) => 'content' in b)
        .map((b) => ('content' in b ? b.content : ''));

      expect(allContent.some((c) => c.includes('前週のTry'))).toBe(true);
      expect(allContent.some((c) => c.includes('前週のTry1'))).toBe(true);
    });

    it('should skip previous Try section when no previous items exist', async () => {
      const analysis = createMockAnalysisResult();
      const data = createMockIntegratedData();
      const options: PageBuildOptions = {
        dryRun: false,
        databaseId: 'test-database-id',
      };

      mockNotionClient.createPage.mockResolvedValue(
        ok({
          id: 'page-123',
          url: 'https://notion.so/page-123',
          createdTime: '2026-02-02T19:00:00Z',
          properties: {},
        } as NotionPage)
      );

      await builder.buildAndCreate(analysis, data, options);

      const [content] = mockNotionClient.createPage.mock.calls[0] as [NotionPageContent, string];
      const headingContents = content.blocks
        .filter((b) => b.type === 'heading_1' || b.type === 'heading_2')
        .map((b) => ('content' in b ? b.content : ''));

      expect(headingContents.some((h) => h.includes('前週のTry'))).toBe(false);
    });

    it('should not create Notion page in dry run mode', async () => {
      const analysis = createMockAnalysisResult();
      const data = createMockIntegratedData();
      const options: PageBuildOptions = {
        dryRun: true,
        databaseId: 'test-database-id',
      };

      const result = await builder.buildAndCreate(analysis, data, options);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.pageUrl).toBeUndefined();
        expect(result.value.title).toContain('2026-01-27');
      }
      expect(mockNotionClient.createPage).not.toHaveBeenCalled();
    });

    it('should return error with fallback when Notion API fails', async () => {
      const analysis = createMockAnalysisResult();
      const data = createMockIntegratedData();
      const options = createMockPageBuildOptions();

      mockNotionClient.createPage.mockResolvedValue(
        err({ type: 'SERVICE_UNAVAILABLE', message: 'Notion down' } as NotionError)
      );

      const result = await builder.buildAndCreate(analysis, data, options);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('NOTION_API_ERROR');
        // Should have generated fallback path hint
        expect(result.error.message).toContain('Notion');
      }
    });

    it('should include week number and tags in properties', async () => {
      const analysis = createMockAnalysisResult();
      const data = createMockIntegratedData();
      const options = createMockPageBuildOptions();

      mockNotionClient.createPage.mockResolvedValue(
        ok({
          id: 'page-123',
          url: 'https://notion.so/page-123',
          createdTime: '2026-02-02T19:00:00Z',
          properties: {},
        } as NotionPage)
      );

      await builder.buildAndCreate(analysis, data, options);

      const [content] = mockNotionClient.createPage.mock.calls[0] as [NotionPageContent, string];
      expect(content.properties.weekNumber).toBeGreaterThanOrEqual(1);
      expect(content.properties.weekNumber).toBeLessThanOrEqual(53);
      expect(content.properties.dateRange).toContain('2026-01-27');
    });

    it('should include KPT placeholder text for each section', async () => {
      const analysis = createMockAnalysisResult();
      const data = createMockIntegratedData();
      const options = createMockPageBuildOptions();

      mockNotionClient.createPage.mockResolvedValue(
        ok({
          id: 'page-123',
          url: 'https://notion.so/page-123',
          createdTime: '2026-02-02T19:00:00Z',
          properties: {},
        } as NotionPage)
      );

      await builder.buildAndCreate(analysis, data, options);

      const [content] = mockNotionClient.createPage.mock.calls[0] as [NotionPageContent, string];
      const paragraphs = content.blocks
        .filter((b) => b.type === 'paragraph')
        .map((b) => ('content' in b ? b.content : ''));

      // Should have placeholder text in KPT sections
      expect(paragraphs.some((p) => p.includes('ここに') || p.includes('記入'))).toBe(true);
    });
  });

  describe('buildMarkdown', () => {
    it('should generate valid Markdown content', () => {
      const analysis = createMockAnalysisResult();
      const data = createMockIntegratedData();

      const markdown = builder.buildMarkdown(analysis, data);

      expect(markdown.length).toBeGreaterThan(0);
      // Should contain markdown headings
      expect(markdown).toContain('# ');
      expect(markdown).toContain('## ');
    });

    it('should include all sections in Markdown output', () => {
      const analysis = createMockAnalysisResult();
      const data = createMockIntegratedData();

      const markdown = builder.buildMarkdown(analysis, data);

      // Check all key sections
      expect(markdown).toMatch(/サマリー|概要/);
      expect(markdown).toMatch(/GitHub|PR/);
      expect(markdown).toMatch(/Toggl|作業時間/);
      expect(markdown).toContain('Keep');
      expect(markdown).toContain('Problem');
      expect(markdown).toContain('Try');
    });

    it('should include PR details in Markdown', () => {
      const analysis = createMockAnalysisResult();
      const data = createMockIntegratedData();

      const markdown = builder.buildMarkdown(analysis, data);

      expect(markdown).toContain('feat: add feature A');
      expect(markdown).toContain('owner/repo1');
    });

    it('should include time entry details in Markdown', () => {
      const analysis = createMockAnalysisResult();
      const data = createMockIntegratedData();

      const markdown = builder.buildMarkdown(analysis, data);

      expect(markdown).toContain('Feature A development');
      expect(markdown).toContain('Project Alpha');
    });

    it('should include KPT suggestions in Markdown', () => {
      const analysis = createMockAnalysisResult();
      const data = createMockIntegratedData();

      const markdown = builder.buildMarkdown(analysis, data);

      expect(markdown).toContain('継続的なPR活動');
      expect(markdown).toContain('作業時間が短い日がある');
      expect(markdown).toContain('作業時間を均等に分配する');
    });
  });
});
