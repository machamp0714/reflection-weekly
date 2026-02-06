import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { GitHubClient, DateRange } from './github-client.js';

// Mock axios properly
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: vi.fn(() => ({
        get: vi.fn(),
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
      })),
    },
  };
});

describe('GitHubClient', () => {
  let client: GitHubClient;
  let mockGet: ReturnType<typeof vi.fn>;

  const testDateRange: DateRange = {
    start: new Date('2026-01-27T00:00:00Z'),
    end: new Date('2026-02-02T23:59:59Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GitHubClient({ token: 'ghp_test_token' });
    // Get the mock get function from the created instance
    const mockAxiosCreate = axios.create as ReturnType<typeof vi.fn>;
    const mockInstance = mockAxiosCreate.mock.results[0]?.value as { get: ReturnType<typeof vi.fn> };
    mockGet = mockInstance.get;
  });

  describe('getCommits', () => {
    it('should fetch commits for a repository within date range', async () => {
      const mockCommits = [
        {
          sha: 'abc123',
          commit: {
            message: 'feat: add new feature',
            author: {
              name: 'Test User',
              email: 'test@example.com',
              date: '2026-01-28T10:00:00Z',
            },
          },
          html_url: 'https://github.com/owner/repo/commit/abc123',
          stats: {
            additions: 100,
            deletions: 20,
            total: 120,
          },
        },
        {
          sha: 'def456',
          commit: {
            message: 'fix: resolve bug',
            author: {
              name: 'Test User',
              email: 'test@example.com',
              date: '2026-01-29T14:30:00Z',
            },
          },
          html_url: 'https://github.com/owner/repo/commit/def456',
        },
      ];

      mockGet.mockResolvedValueOnce({
        data: mockCommits,
        headers: {},
      });

      const result = await client.getCommits('owner/repo', testDateRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].sha).toBe('abc123');
        expect(result.value[0].message).toBe('feat: add new feature');
        expect(result.value[1].sha).toBe('def456');
      }
    });

    it('should handle pagination with link header', async () => {
      const page1Commits = Array(100)
        .fill(null)
        .map((_, i) => ({
          sha: `sha1_${i}`,
          commit: {
            message: `Commit ${i}`,
            author: {
              name: 'Test User',
              email: 'test@example.com',
              date: '2026-01-28T10:00:00Z',
            },
          },
          html_url: `https://github.com/owner/repo/commit/sha1_${i}`,
        }));

      const page2Commits = Array(10)
        .fill(null)
        .map((_, i) => ({
          sha: `sha2_${i}`,
          commit: {
            message: `Commit ${100 + i}`,
            author: {
              name: 'Test User',
              email: 'test@example.com',
              date: '2026-01-29T10:00:00Z',
            },
          },
          html_url: `https://github.com/owner/repo/commit/sha2_${i}`,
        }));

      mockGet
        .mockResolvedValueOnce({
          data: page1Commits,
          headers: { link: '<https://api.github.com/repos/owner/repo/commits?page=2>; rel="next"' },
        })
        .mockResolvedValueOnce({
          data: page2Commits,
          headers: {},
        });

      const result = await client.getCommits('owner/repo', testDateRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(110);
      }
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('should return UNAUTHORIZED error for 401 response', async () => {
      const error = new Error('Unauthorized');
      Object.assign(error, {
        isAxiosError: true,
        response: { status: 401, data: { message: 'Bad credentials' } },
      });

      mockGet.mockRejectedValueOnce(error);

      const result = await client.getCommits('owner/repo', testDateRange);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('UNAUTHORIZED');
      }
    });

    it('should return RATE_LIMITED error for 403 with rate limit message', async () => {
      const error = new Error('Rate limit exceeded');
      Object.assign(error, {
        isAxiosError: true,
        response: {
          status: 403,
          data: { message: 'API rate limit exceeded' },
          headers: { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600) },
        },
      });

      mockGet.mockRejectedValueOnce(error);

      const result = await client.getCommits('owner/repo', testDateRange);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('RATE_LIMITED');
      }
    });

    it('should return NOT_FOUND error for 404 response', async () => {
      const error = new Error('Not Found');
      Object.assign(error, {
        isAxiosError: true,
        response: { status: 404, data: { message: 'Not Found' } },
      });

      mockGet.mockRejectedValueOnce(error);

      const result = await client.getCommits('owner/nonexistent', testDateRange);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('NOT_FOUND');
        expect(result.error.repository).toBe('owner/nonexistent');
      }
    });

    it('should return NETWORK_ERROR for network failures', async () => {
      const error = new Error('Network Error');
      Object.assign(error, {
        isAxiosError: true,
        code: 'ECONNREFUSED',
      });

      mockGet.mockRejectedValueOnce(error);

      const result = await client.getCommits('owner/repo', testDateRange);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('NETWORK_ERROR');
      }
    });

    it('should filter commits by author when provided', async () => {
      const mockCommits = [
        {
          sha: 'abc123',
          commit: {
            message: 'test',
            author: { name: 'Test', email: 'test@example.com', date: '2026-01-28T10:00:00Z' },
          },
          html_url: 'https://github.com/owner/repo/commit/abc123',
        },
      ];

      mockGet.mockResolvedValueOnce({
        data: mockCommits,
        headers: {},
      });

      const result = await client.getCommits('owner/repo', testDateRange, { author: 'testuser' });

      expect(result.success).toBe(true);
      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/repos/owner/repo/commits'),
        expect.objectContaining({
          params: expect.objectContaining({ author: 'testuser' }),
        })
      );
    });

    it('should return empty array when no commits exist', async () => {
      mockGet.mockResolvedValueOnce({
        data: [],
        headers: {},
      });

      const result = await client.getCommits('owner/repo', testDateRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(0);
      }
    });
  });

  describe('getCommitStats', () => {
    it('should fetch commit stats when available', async () => {
      const mockCommit = {
        sha: 'abc123',
        commit: {
          message: 'test',
          author: { name: 'Test', email: 'test@example.com', date: '2026-01-28T10:00:00Z' },
        },
        html_url: 'https://github.com/owner/repo/commit/abc123',
        stats: {
          additions: 50,
          deletions: 10,
          total: 60,
        },
        files: [{ filename: 'src/index.ts', additions: 50, deletions: 10 }],
      };

      mockGet.mockResolvedValueOnce({
        data: mockCommit,
        headers: {},
      });

      const result = await client.getCommitStats('owner/repo', 'abc123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.additions).toBe(50);
        expect(result.value.deletions).toBe(10);
        expect(result.value.filesChanged).toBe(1);
      }
    });
  });

  describe('repository name validation', () => {
    it('should reject invalid repository format', async () => {
      const result = await client.getCommits('invalidrepo', testDateRange);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('NOT_FOUND');
      }
    });
  });
});
