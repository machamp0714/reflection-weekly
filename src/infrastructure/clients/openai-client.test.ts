import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { OpenAIClient, SummaryInput, KPTInput } from './openai-client.js';

// Mock axios
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: vi.fn(() => ({
        post: vi.fn(),
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
      })),
    },
  };
});

describe('OpenAIClient', () => {
  let client: OpenAIClient;
  let mockPost: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new OpenAIClient({ apiKey: 'sk-test-key-12345' });
    const mockAxiosCreate = axios.create as ReturnType<typeof vi.fn>;
    const mockInstance = mockAxiosCreate.mock.results[0]?.value as { post: ReturnType<typeof vi.fn> };
    mockPost = mockInstance.post;
  });

  describe('generateSummary', () => {
    it('should generate activity summary', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-123',
          choices: [
            {
              message: {
                role: 'assistant',
                content: '今週は主にフロントエンド開発に注力しました。Reactコンポーネントの実装が完了し、テストカバレッジも向上しました。',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        },
      };

      mockPost.mockResolvedValueOnce(mockResponse);

      const input: SummaryInput = {
        commits: [
          { message: 'feat: add login form', repository: 'owner/repo', date: '2026-01-28' },
          { message: 'fix: validation bug', repository: 'owner/repo', date: '2026-01-29' },
        ],
        timeEntries: [
          { description: 'Frontend development', projectName: 'Project A', durationHours: 8 },
        ],
        period: { start: '2026-01-27', end: '2026-02-02' },
      };

      const result = await client.generateSummary(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toContain('フロントエンド');
      }
    });

    it('should handle empty commits and time entries', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-124',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'この期間の活動記録がありません。',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        },
      };

      mockPost.mockResolvedValueOnce(mockResponse);

      const input: SummaryInput = {
        commits: [],
        timeEntries: [],
        period: { start: '2026-01-27', end: '2026-02-02' },
      };

      const result = await client.generateSummary(input);

      expect(result.success).toBe(true);
    });

    it('should return UNAUTHORIZED error for 401 response', async () => {
      const error = new Error('Unauthorized');
      Object.assign(error, {
        isAxiosError: true,
        response: { status: 401, data: { error: { message: 'Invalid API key' } } },
      });

      mockPost.mockRejectedValueOnce(error);

      const input: SummaryInput = {
        commits: [],
        timeEntries: [],
        period: { start: '2026-01-27', end: '2026-02-02' },
      };

      const result = await client.generateSummary(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('UNAUTHORIZED');
      }
    });

    it('should return RATE_LIMITED error for 429 response after retries', async () => {
      const error = new Error('Rate limited');
      Object.assign(error, {
        isAxiosError: true,
        response: { status: 429, headers: { 'retry-after': '30' } },
      });

      // Mock persistent failure to exhaust retries
      mockPost.mockRejectedValue(error);

      const input: SummaryInput = {
        commits: [],
        timeEntries: [],
        period: { start: '2026-01-27', end: '2026-02-02' },
      };

      const result = await client.generateSummary(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('RATE_LIMITED');
      }
    }, 30000);
  });

  describe('generateKPTSuggestions', () => {
    it('should generate KPT suggestions', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-125',
          choices: [
            {
              message: {
                role: 'assistant',
                content: `\`\`\`json
{
  "keep": ["定期的なコミット", "テスト駆動開発"],
  "problem": ["ドキュメント不足"],
  "try": ["コードレビューの実施"]
}
\`\`\``,
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
        },
      };

      mockPost.mockResolvedValueOnce(mockResponse);

      const input: KPTInput = {
        weekSummary: '今週は主にフロントエンド開発を行いました。',
        highlights: ['ログイン機能の実装', 'テストカバレッジ向上'],
      };

      const result = await client.generateKPTSuggestions(input);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.keep).toContain('定期的なコミット');
        expect(result.value.problem).toContain('ドキュメント不足');
        expect(result.value.tryItems).toContain('コードレビューの実施');
      }
    });

    it('should include previous try items in prompt', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-126',
          choices: [
            {
              message: {
                role: 'assistant',
                content: '{"keep": [], "problem": [], "try": []}',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
        },
      };

      mockPost.mockResolvedValueOnce(mockResponse);

      const input: KPTInput = {
        weekSummary: 'Summary',
        highlights: [],
        previousTryItems: ['前週のTry項目1', '前週のTry項目2'],
      };

      await client.generateKPTSuggestions(input);

      expect(mockPost).toHaveBeenCalledWith(
        '/chat/completions',
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.stringContaining('前週のTry項目'),
            }),
          ]),
        })
      );
    });

    it('should return default KPT when parsing fails', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-127',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'Invalid response without JSON',
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
        },
      };

      mockPost.mockResolvedValueOnce(mockResponse);

      const input: KPTInput = {
        weekSummary: 'Summary',
        highlights: [],
      };

      const result = await client.generateKPTSuggestions(input);

      expect(result.success).toBe(true);
      if (result.success) {
        // Should return default values
        expect(result.value.keep.length).toBeGreaterThan(0);
      }
    });
  });

  describe('error handling', () => {
    it('should handle empty response', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-128',
          choices: [],
          usage: { prompt_tokens: 50, completion_tokens: 0, total_tokens: 50 },
        },
      };

      mockPost.mockResolvedValueOnce(mockResponse);

      const input: SummaryInput = {
        commits: [],
        timeEntries: [],
        period: { start: '2026-01-27', end: '2026-02-02' },
      };

      const result = await client.generateSummary(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('SERVICE_UNAVAILABLE');
      }
    });
  });
});
