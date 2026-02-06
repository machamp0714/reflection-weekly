import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataIntegrator } from './data-integrator.js';
import { ok, err } from '../types/result.js';
import type { GitHubCommit, GitHubError } from '../infrastructure/clients/github-client.js';
import type { TogglTimeEntry, TogglError } from '../infrastructure/clients/toggl-client.js';
import type { DateRange, DataSourceConfig } from './data-integrator.js';

/**
 * DataIntegrator テスト
 * Task 3.1: データ統合機能のテスト
 */

// Mock GitHub client
const createMockGitHubClient = () => ({
  getCommits: vi.fn(),
  getCommitStats: vi.fn(),
});

// Mock Toggl client
const createMockTogglClient = () => ({
  getTimeEntries: vi.fn(),
  getProjects: vi.fn(),
  getProjectName: vi.fn(),
  getTimeEntriesWithProjectNames: vi.fn(),
});

// Test data helpers
const createDateRange = (): DateRange => ({
  start: new Date('2026-01-27T00:00:00Z'),
  end: new Date('2026-02-02T23:59:59Z'),
});

const createDataSourceConfig = (): DataSourceConfig => ({
  repositories: ['owner/repo1', 'owner/repo2'],
  workspaceId: 12345,
});

const createMockCommits = (repoName: string): GitHubCommit[] => [
  {
    sha: 'abc123',
    message: 'feat: add feature A',
    author: { name: 'Test User', email: 'test@example.com', date: '2026-01-28T10:00:00Z' },
    url: `https://github.com/${repoName}/commit/abc123`,
    stats: { additions: 50, deletions: 10, total: 60 },
  },
  {
    sha: 'def456',
    message: 'fix: bug fix B',
    author: { name: 'Test User', email: 'test@example.com', date: '2026-01-29T14:00:00Z' },
    url: `https://github.com/${repoName}/commit/def456`,
    stats: { additions: 5, deletions: 3, total: 8 },
  },
];

const createMockTimeEntries = (): (TogglTimeEntry & { projectName: string })[] => [
  {
    id: 1,
    description: 'Feature A development',
    start: '2026-01-28T09:00:00Z',
    stop: '2026-01-28T12:00:00Z',
    duration: 10800, // 3 hours
    projectId: 100,
    workspaceId: 12345,
    tags: ['dev'],
    billable: true,
    projectName: 'Project Alpha',
  },
  {
    id: 2,
    description: 'Code review',
    start: '2026-01-29T13:00:00Z',
    stop: '2026-01-29T15:00:00Z',
    duration: 7200, // 2 hours
    projectId: 100,
    workspaceId: 12345,
    tags: ['review'],
    billable: true,
    projectName: 'Project Alpha',
  },
  {
    id: 3,
    description: 'Design meeting',
    start: '2026-01-30T10:00:00Z',
    stop: '2026-01-30T11:30:00Z',
    duration: 5400, // 1.5 hours
    projectId: 200,
    workspaceId: 12345,
    tags: ['meeting'],
    billable: false,
    projectName: 'Project Beta',
  },
];

describe('DataIntegrator', () => {
  let mockGitHubClient: ReturnType<typeof createMockGitHubClient>;
  let mockTogglClient: ReturnType<typeof createMockTogglClient>;
  let integrator: DataIntegrator;

  beforeEach(() => {
    mockGitHubClient = createMockGitHubClient();
    mockTogglClient = createMockTogglClient();
    integrator = new DataIntegrator(mockGitHubClient, mockTogglClient);
  });

  describe('collectAndIntegrate', () => {
    it('should collect and integrate data from both GitHub and Toggl', async () => {
      const dateRange = createDateRange();
      const config = createDataSourceConfig();

      // Setup mocks: both repos return commits
      mockGitHubClient.getCommits
        .mockResolvedValueOnce(ok(createMockCommits('owner/repo1')))
        .mockResolvedValueOnce(ok(createMockCommits('owner/repo2')));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(ok(createMockTimeEntries()));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.commits.length).toBe(4); // 2 commits x 2 repos
        expect(result.value.timeEntries.length).toBe(3);
        expect(result.value.dateRange).toEqual(dateRange);
        expect(result.value.warnings.length).toBe(0);
      }
    });

    it('should generate daily summaries correctly', async () => {
      const dateRange = createDateRange();
      const config = createDataSourceConfig();

      mockGitHubClient.getCommits
        .mockResolvedValueOnce(ok(createMockCommits('owner/repo1')))
        .mockResolvedValueOnce(ok([]));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(ok(createMockTimeEntries()));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.dailySummaries.length).toBeGreaterThan(0);

        // Check Jan 28 summary: 1 commit + 3h work
        const jan28Summary = result.value.dailySummaries.find(
          (s) => s.date.toISOString().startsWith('2026-01-28')
        );
        expect(jan28Summary).toBeDefined();
        if (jan28Summary) {
          expect(jan28Summary.commitCount).toBe(1);
          expect(jan28Summary.workHours).toBeCloseTo(3.0, 1);
        }
      }
    });

    it('should generate project summaries correctly', async () => {
      const dateRange = createDateRange();
      const config = createDataSourceConfig();

      mockGitHubClient.getCommits
        .mockResolvedValueOnce(ok(createMockCommits('owner/repo1')))
        .mockResolvedValueOnce(ok([]));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(ok(createMockTimeEntries()));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.projectSummaries.length).toBeGreaterThan(0);

        const alphaProject = result.value.projectSummaries.find(
          (p) => p.projectName === 'Project Alpha'
        );
        expect(alphaProject).toBeDefined();
        if (alphaProject) {
          expect(alphaProject.totalWorkHours).toBeCloseTo(5.0, 1); // 3 + 2 hours
        }
      }
    });

    it('should continue with warnings when GitHub fails', async () => {
      const dateRange = createDateRange();
      const config = createDataSourceConfig();

      mockGitHubClient.getCommits
        .mockResolvedValue(err({ type: 'NETWORK_ERROR', message: 'timeout' } as GitHubError));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(ok(createMockTimeEntries()));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.commits.length).toBe(0);
        expect(result.value.timeEntries.length).toBe(3);
        expect(result.value.warnings.length).toBeGreaterThan(0);
        expect(result.value.warnings.some((w) => w.type === 'PARTIAL_DATA')).toBe(true);
      }
    });

    it('should continue with warnings when Toggl fails', async () => {
      const dateRange = createDateRange();
      const config = createDataSourceConfig();

      mockGitHubClient.getCommits
        .mockResolvedValueOnce(ok(createMockCommits('owner/repo1')))
        .mockResolvedValueOnce(ok([]));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(err({ type: 'NETWORK_ERROR', message: 'timeout' } as TogglError));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.commits.length).toBe(2);
        expect(result.value.timeEntries.length).toBe(0);
        expect(result.value.warnings.length).toBeGreaterThan(0);
        expect(result.value.warnings.some((w) => w.type === 'PARTIAL_DATA')).toBe(true);
      }
    });

    it('should add NO_COMMITS warning when no commits found', async () => {
      const dateRange = createDateRange();
      const config = createDataSourceConfig();

      mockGitHubClient.getCommits
        .mockResolvedValue(ok([]));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(ok(createMockTimeEntries()));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.commits.length).toBe(0);
        expect(result.value.warnings.some((w) => w.type === 'NO_COMMITS')).toBe(true);
      }
    });

    it('should add NO_TIME_ENTRIES warning when no time entries found', async () => {
      const dateRange = createDateRange();
      const config = createDataSourceConfig();

      mockGitHubClient.getCommits
        .mockResolvedValue(ok(createMockCommits('owner/repo1')));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(ok([]));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.timeEntries.length).toBe(0);
        expect(result.value.warnings.some((w) => w.type === 'NO_TIME_ENTRIES')).toBe(true);
      }
    });

    it('should return error when all data sources fail', async () => {
      const dateRange = createDateRange();
      const config = createDataSourceConfig();

      mockGitHubClient.getCommits
        .mockResolvedValue(err({ type: 'NETWORK_ERROR', message: 'timeout' } as GitHubError));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(err({ type: 'NETWORK_ERROR', message: 'timeout' } as TogglError));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('ALL_SOURCES_FAILED');
      }
    });

    it('should collect commits from multiple repositories in parallel', async () => {
      const dateRange = createDateRange();
      const config: DataSourceConfig = {
        repositories: ['owner/repo1', 'owner/repo2', 'owner/repo3'],
      };

      mockGitHubClient.getCommits
        .mockResolvedValueOnce(ok(createMockCommits('owner/repo1')))
        .mockResolvedValueOnce(ok(createMockCommits('owner/repo2')))
        .mockResolvedValueOnce(ok(createMockCommits('owner/repo3')));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(ok([]));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.commits.length).toBe(6); // 2 commits x 3 repos
      }

      // Verify all repos were queried
      expect(mockGitHubClient.getCommits).toHaveBeenCalledTimes(3);
    });

    it('should map commit data to CommitData format', async () => {
      const dateRange = createDateRange();
      const config: DataSourceConfig = {
        repositories: ['owner/repo1'],
      };

      mockGitHubClient.getCommits
        .mockResolvedValueOnce(ok(createMockCommits('owner/repo1')));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(ok([]));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        const commit = result.value.commits[0];
        expect(commit.sha).toBe('abc123');
        expect(commit.message).toBe('feat: add feature A');
        expect(commit.repository).toBe('owner/repo1');
        expect(commit.filesChanged).toBe(60); // total from stats
        expect(commit.additions).toBe(50);
        expect(commit.deletions).toBe(10);
      }
    });

    it('should map time entry data to TimeEntryData format', async () => {
      const dateRange = createDateRange();
      const config = createDataSourceConfig();

      mockGitHubClient.getCommits.mockResolvedValue(ok([]));
      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(ok(createMockTimeEntries()));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        const entry = result.value.timeEntries[0];
        expect(entry.id).toBe(1);
        expect(entry.description).toBe('Feature A development');
        expect(entry.projectName).toBe('Project Alpha');
        expect(entry.durationSeconds).toBe(10800);
        expect(entry.tags).toEqual(['dev']);
      }
    });
  });
});
