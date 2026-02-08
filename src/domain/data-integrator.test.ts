import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataIntegrator } from './data-integrator.js';
import { ok, err } from '../types/result.js';
import type { GitHubPullRequest, GitHubError } from '../infrastructure/clients/github-client.js';
import type { TogglTimeEntry, TogglError } from '../infrastructure/clients/toggl-client.js';
import type { DateRange, DataSourceConfig } from './data-integrator.js';

/**
 * DataIntegrator テスト
 * Task 3.1: データ統合機能のテスト (PR版)
 */

// Mock GitHub client
const createMockGitHubClient = () => ({
  getPullRequests: vi.fn(),
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

const createMockPullRequests = (repoName: string): GitHubPullRequest[] => [
  {
    number: 42,
    title: 'feat: add feature A',
    body: 'This PR adds feature A.',
    user: { login: 'testuser' },
    createdAt: '2026-01-28T10:00:00Z',
    url: `https://api.github.com/repos/${repoName}/pulls/42`,
    htmlUrl: `https://github.com/${repoName}/pull/42`,
    state: 'closed',
    merged: true,
  },
  {
    number: 43,
    title: 'fix: bug fix B',
    body: 'Fixes bug B.',
    user: { login: 'testuser' },
    createdAt: '2026-01-29T14:00:00Z',
    url: `https://api.github.com/repos/${repoName}/pulls/43`,
    htmlUrl: `https://github.com/${repoName}/pull/43`,
    state: 'open',
    merged: false,
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

      // Setup mocks: both repos return PRs
      mockGitHubClient.getPullRequests
        .mockResolvedValueOnce(ok(createMockPullRequests('owner/repo1')))
        .mockResolvedValueOnce(ok(createMockPullRequests('owner/repo2')));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(ok(createMockTimeEntries()));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.pullRequests.length).toBe(4); // 2 PRs x 2 repos
        expect(result.value.timeEntries.length).toBe(3);
        expect(result.value.dateRange).toEqual(dateRange);
        expect(result.value.warnings.length).toBe(0);
      }
    });

    it('should generate daily summaries correctly', async () => {
      const dateRange = createDateRange();
      const config = createDataSourceConfig();

      mockGitHubClient.getPullRequests
        .mockResolvedValueOnce(ok(createMockPullRequests('owner/repo1')))
        .mockResolvedValueOnce(ok([]));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(ok(createMockTimeEntries()));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.dailySummaries.length).toBeGreaterThan(0);

        // Check Jan 28 summary: 1 PR + 3h work
        const jan28Summary = result.value.dailySummaries.find(
          (s) => s.date.toISOString().startsWith('2026-01-28')
        );
        expect(jan28Summary).toBeDefined();
        if (jan28Summary) {
          expect(jan28Summary.prCount).toBe(1);
          expect(jan28Summary.workHours).toBeCloseTo(3.0, 1);
        }
      }
    });

    it('should generate project summaries correctly', async () => {
      const dateRange = createDateRange();
      const config = createDataSourceConfig();

      mockGitHubClient.getPullRequests
        .mockResolvedValueOnce(ok(createMockPullRequests('owner/repo1')))
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

      mockGitHubClient.getPullRequests
        .mockResolvedValue(err({ type: 'NETWORK_ERROR', message: 'timeout' } as GitHubError));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(ok(createMockTimeEntries()));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.pullRequests.length).toBe(0);
        expect(result.value.timeEntries.length).toBe(3);
        expect(result.value.warnings.length).toBeGreaterThan(0);
        expect(result.value.warnings.some((w) => w.type === 'PARTIAL_DATA')).toBe(true);
      }
    });

    it('should continue with warnings when Toggl fails', async () => {
      const dateRange = createDateRange();
      const config = createDataSourceConfig();

      mockGitHubClient.getPullRequests
        .mockResolvedValueOnce(ok(createMockPullRequests('owner/repo1')))
        .mockResolvedValueOnce(ok([]));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(err({ type: 'NETWORK_ERROR', message: 'timeout' } as TogglError));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.pullRequests.length).toBe(2);
        expect(result.value.timeEntries.length).toBe(0);
        expect(result.value.warnings.length).toBeGreaterThan(0);
        expect(result.value.warnings.some((w) => w.type === 'PARTIAL_DATA')).toBe(true);
      }
    });

    it('should add NO_PULL_REQUESTS warning when no PRs found', async () => {
      const dateRange = createDateRange();
      const config = createDataSourceConfig();

      mockGitHubClient.getPullRequests
        .mockResolvedValue(ok([]));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(ok(createMockTimeEntries()));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.pullRequests.length).toBe(0);
        expect(result.value.warnings.some((w) => w.type === 'NO_PULL_REQUESTS')).toBe(true);
      }
    });

    it('should add NO_TIME_ENTRIES warning when no time entries found', async () => {
      const dateRange = createDateRange();
      const config = createDataSourceConfig();

      mockGitHubClient.getPullRequests
        .mockResolvedValue(ok(createMockPullRequests('owner/repo1')));

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

      mockGitHubClient.getPullRequests
        .mockResolvedValue(err({ type: 'NETWORK_ERROR', message: 'timeout' } as GitHubError));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(err({ type: 'NETWORK_ERROR', message: 'timeout' } as TogglError));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('ALL_SOURCES_FAILED');
      }
    });

    it('should collect PRs from multiple repositories in parallel', async () => {
      const dateRange = createDateRange();
      const config: DataSourceConfig = {
        repositories: ['owner/repo1', 'owner/repo2', 'owner/repo3'],
      };

      mockGitHubClient.getPullRequests
        .mockResolvedValueOnce(ok(createMockPullRequests('owner/repo1')))
        .mockResolvedValueOnce(ok(createMockPullRequests('owner/repo2')))
        .mockResolvedValueOnce(ok(createMockPullRequests('owner/repo3')));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(ok([]));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.pullRequests.length).toBe(6); // 2 PRs x 3 repos
      }

      // Verify all repos were queried
      expect(mockGitHubClient.getPullRequests).toHaveBeenCalledTimes(3);
    });

    it('should map PR data to PullRequestData format', async () => {
      const dateRange = createDateRange();
      const config: DataSourceConfig = {
        repositories: ['owner/repo1'],
      };

      mockGitHubClient.getPullRequests
        .mockResolvedValueOnce(ok(createMockPullRequests('owner/repo1')));

      mockTogglClient.getTimeEntriesWithProjectNames
        .mockResolvedValue(ok([]));

      const result = await integrator.collectAndIntegrate(dateRange, config);

      expect(result.success).toBe(true);
      if (result.success) {
        const pr = result.value.pullRequests[0];
        expect(pr.number).toBe(42);
        expect(pr.title).toBe('feat: add feature A');
        expect(pr.description).toBe('This PR adds feature A.');
        expect(pr.repository).toBe('owner/repo1');
        expect(pr.url).toBe('https://github.com/owner/repo1/pull/42');
        expect(pr.state).toBe('merged'); // closed + merged = 'merged'
      }
    });

    it('should map time entry data to TimeEntryData format', async () => {
      const dateRange = createDateRange();
      const config = createDataSourceConfig();

      mockGitHubClient.getPullRequests.mockResolvedValue(ok([]));
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
