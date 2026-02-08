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

  describe('getPullRequests', () => {
    it('should fetch pull requests for a repository within date range', async () => {
      const mockPRs = [
        {
          number: 42,
          title: 'feat: add new feature',
          body: 'This PR adds a new feature for users.',
          user: { login: 'testuser' },
          created_at: '2026-01-28T10:00:00Z',
          url: 'https://api.github.com/repos/owner/repo/pulls/42',
          html_url: 'https://github.com/owner/repo/pull/42',
          state: 'open',
          merged_at: null,
        },
        {
          number: 43,
          title: 'fix: resolve bug',
          body: 'Fixes issue #100',
          user: { login: 'testuser' },
          created_at: '2026-01-29T14:30:00Z',
          url: 'https://api.github.com/repos/owner/repo/pulls/43',
          html_url: 'https://github.com/owner/repo/pull/43',
          state: 'closed',
          merged_at: '2026-01-30T10:00:00Z',
        },
      ];

      mockGet.mockResolvedValueOnce({
        data: mockPRs,
        headers: {},
      });

      const result = await client.getPullRequests('owner/repo', testDateRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].number).toBe(42);
        expect(result.value[0].title).toBe('feat: add new feature');
        expect(result.value[0].body).toBe('This PR adds a new feature for users.');
        expect(result.value[0].state).toBe('open');
        expect(result.value[0].merged).toBe(false);
        expect(result.value[0].htmlUrl).toBe('https://github.com/owner/repo/pull/42');
        expect(result.value[0].user.login).toBe('testuser');
        expect(result.value[0].createdAt).toBe('2026-01-28T10:00:00Z');
        expect(result.value[1].number).toBe(43);
        expect(result.value[1].merged).toBe(true);
      }
    });

    it('should filter PRs by date range (only PRs created within range)', async () => {
      const mockPRs = [
        {
          number: 41,
          title: 'old PR before date range',
          body: null,
          user: { login: 'testuser' },
          created_at: '2026-01-20T10:00:00Z',
          url: 'https://api.github.com/repos/owner/repo/pulls/41',
          html_url: 'https://github.com/owner/repo/pull/41',
          state: 'closed',
          merged_at: null,
        },
        {
          number: 42,
          title: 'PR within date range',
          body: 'In range',
          user: { login: 'testuser' },
          created_at: '2026-01-28T10:00:00Z',
          url: 'https://api.github.com/repos/owner/repo/pulls/42',
          html_url: 'https://github.com/owner/repo/pull/42',
          state: 'open',
          merged_at: null,
        },
        {
          number: 44,
          title: 'PR after date range',
          body: 'After range',
          user: { login: 'testuser' },
          created_at: '2026-02-10T10:00:00Z',
          url: 'https://api.github.com/repos/owner/repo/pulls/44',
          html_url: 'https://github.com/owner/repo/pull/44',
          state: 'open',
          merged_at: null,
        },
      ];

      mockGet.mockResolvedValueOnce({
        data: mockPRs,
        headers: {},
      });

      const result = await client.getPullRequests('owner/repo', testDateRange);

      expect(result.success).toBe(true);
      if (result.success) {
        // Only the PR within the date range should remain
        expect(result.value).toHaveLength(1);
        expect(result.value[0].number).toBe(42);
      }
    });

    it('should handle pagination with link header', async () => {
      const page1PRs = Array(100)
        .fill(null)
        .map((_, i) => ({
          number: i + 1,
          title: `PR ${i + 1}`,
          body: `Description for PR ${i + 1}`,
          user: { login: 'testuser' },
          created_at: '2026-01-28T10:00:00Z',
          url: `https://api.github.com/repos/owner/repo/pulls/${i + 1}`,
          html_url: `https://github.com/owner/repo/pull/${i + 1}`,
          state: 'open',
          merged_at: null,
        }));

      const page2PRs = Array(10)
        .fill(null)
        .map((_, i) => ({
          number: 101 + i,
          title: `PR ${101 + i}`,
          body: `Description for PR ${101 + i}`,
          user: { login: 'testuser' },
          created_at: '2026-01-29T10:00:00Z',
          url: `https://api.github.com/repos/owner/repo/pulls/${101 + i}`,
          html_url: `https://github.com/owner/repo/pull/${101 + i}`,
          state: 'closed',
          merged_at: null,
        }));

      mockGet
        .mockResolvedValueOnce({
          data: page1PRs,
          headers: { link: '<https://api.github.com/repos/owner/repo/pulls?page=2>; rel="next"' },
        })
        .mockResolvedValueOnce({
          data: page2PRs,
          headers: {},
        });

      const result = await client.getPullRequests('owner/repo', testDateRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(110);
      }
      expect(mockGet).toHaveBeenCalledTimes(2);
    });

    it('should fetch PRs with all states by default', async () => {
      mockGet.mockResolvedValueOnce({
        data: [],
        headers: {},
      });

      await client.getPullRequests('owner/repo', testDateRange);

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/repos/owner/repo/pulls'),
        expect.objectContaining({
          params: expect.objectContaining({ state: 'all' }),
        })
      );
    });

    it('should allow specifying PR state filter', async () => {
      mockGet.mockResolvedValueOnce({
        data: [],
        headers: {},
      });

      await client.getPullRequests('owner/repo', testDateRange, { state: 'closed' });

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/repos/owner/repo/pulls'),
        expect.objectContaining({
          params: expect.objectContaining({ state: 'closed' }),
        })
      );
    });

    it('should handle PR with null body', async () => {
      const mockPRs = [
        {
          number: 42,
          title: 'PR with no body',
          body: null,
          user: { login: 'testuser' },
          created_at: '2026-01-28T10:00:00Z',
          url: 'https://api.github.com/repos/owner/repo/pulls/42',
          html_url: 'https://github.com/owner/repo/pull/42',
          state: 'open',
          merged_at: null,
        },
      ];

      mockGet.mockResolvedValueOnce({
        data: mockPRs,
        headers: {},
      });

      const result = await client.getPullRequests('owner/repo', testDateRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value[0].body).toBeNull();
      }
    });

    it('should return UNAUTHORIZED error for 401 response', async () => {
      const error = new Error('Unauthorized');
      Object.assign(error, {
        isAxiosError: true,
        response: { status: 401, data: { message: 'Bad credentials' } },
      });

      mockGet.mockRejectedValueOnce(error);

      const result = await client.getPullRequests('owner/repo', testDateRange);

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

      const result = await client.getPullRequests('owner/repo', testDateRange);

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

      const result = await client.getPullRequests('owner/nonexistent', testDateRange);

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

      const result = await client.getPullRequests('owner/repo', testDateRange);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('NETWORK_ERROR');
      }
    });

    it('should return empty array when no PRs exist', async () => {
      mockGet.mockResolvedValueOnce({
        data: [],
        headers: {},
      });

      const result = await client.getPullRequests('owner/repo', testDateRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should sort PRs by created_at descending', async () => {
      mockGet.mockResolvedValueOnce({
        data: [],
        headers: {},
      });

      await client.getPullRequests('owner/repo', testDateRange);

      expect(mockGet).toHaveBeenCalledWith(
        expect.stringContaining('/repos/owner/repo/pulls'),
        expect.objectContaining({
          params: expect.objectContaining({
            sort: 'created',
            direction: 'desc',
          }),
        })
      );
    });
  });

  describe('repository name validation', () => {
    it('should reject invalid repository format', async () => {
      const result = await client.getPullRequests('invalidrepo', testDateRange);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('NOT_FOUND');
      }
    });

    it('空のowner/repoを拒否する', async () => {
      const result = await client.getPullRequests('/repo', testDateRange);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('NOT_FOUND');
      }
    });

    it('空のrepo名を拒否する', async () => {
      const result = await client.getPullRequests('owner/', testDateRange);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('NOT_FOUND');
      }
    });
  });

  describe('リトライ処理', () => {
    it('503エラー後にリトライして成功する', async () => {
      const serverError = new Error('Service Unavailable');
      Object.assign(serverError, {
        isAxiosError: true,
        response: { status: 503, data: { message: 'Service Unavailable' } },
      });

      const mockPRs = [
        {
          number: 42,
          title: 'feat: add feature',
          body: 'PR body',
          user: { login: 'testuser' },
          created_at: '2026-01-28T10:00:00Z',
          url: 'https://api.github.com/repos/owner/repo/pulls/42',
          html_url: 'https://github.com/owner/repo/pull/42',
          state: 'open',
          merged_at: null,
        },
      ];

      // 1回目は503、2回目は成功
      mockGet
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({ data: mockPRs, headers: {} });

      const result = await client.getPullRequests('owner/repo', testDateRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].number).toBe(42);
      }
      // リトライが発生したため2回呼ばれる
      expect(mockGet).toHaveBeenCalledTimes(2);
    }, 30000);

    it('非Axiosエラーの場合NETWORK_ERRORを返す', async () => {
      const genericError = new Error('Something went wrong');

      mockGet.mockRejectedValueOnce(genericError);

      const result = await client.getPullRequests('owner/repo', testDateRange);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('NETWORK_ERROR');
        expect(result.error.message).toBe('Something went wrong');
      }
    });
  });

  describe('403エラーの分類', () => {
    it('レート制限以外の403はUNAUTHORIZEDとして扱う', async () => {
      const forbiddenError = new Error('Forbidden');
      Object.assign(forbiddenError, {
        isAxiosError: true,
        response: {
          status: 403,
          data: { message: 'Resource not accessible' },
          headers: {},
        },
      });

      mockGet.mockRejectedValueOnce(forbiddenError);

      const result = await client.getPullRequests('owner/repo', testDateRange);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('UNAUTHORIZED');
      }
    });
  });
});
