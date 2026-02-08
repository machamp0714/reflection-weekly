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

    it('500エラーの場合SERVICE_UNAVAILABLEを返す', async () => {
      const error = new Error('Internal Server Error');
      Object.assign(error, {
        isAxiosError: true,
        response: { status: 500, data: { error: { message: 'Server error' } } },
      });

      // リトライ後も失敗
      mockPost.mockRejectedValue(error);

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
    }, 30000);

    it('CONTENT_FILTEREDエラーを正しく分類する', async () => {
      const error = new Error('Content filtered');
      Object.assign(error, {
        isAxiosError: true,
        response: {
          status: 400,
          data: { error: { message: 'content_filter triggered' } },
        },
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
        expect(result.error.type).toBe('CONTENT_FILTERED');
      }
    });

    it('TOKEN_LIMIT_EXCEEDEDエラーを正しく分類する', async () => {
      const error = new Error('Token limit');
      Object.assign(error, {
        isAxiosError: true,
        response: {
          status: 400,
          data: { error: { message: 'maximum context length exceeded' } },
        },
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
        // "length"を含むので TOKEN_LIMIT_EXCEEDED
        expect(result.error.type).toBe('TOKEN_LIMIT_EXCEEDED');
      }
    });

    it('非Axiosエラーの場合SERVICE_UNAVAILABLEを返す', async () => {
      const genericError = new Error('Something unexpected');

      mockPost.mockRejectedValueOnce(genericError);

      const input: SummaryInput = {
        commits: [],
        timeEntries: [],
        period: { start: '2026-01-27', end: '2026-02-02' },
      };

      const result = await client.generateSummary(input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('SERVICE_UNAVAILABLE');
        expect(result.error.message).toBe('Something unexpected');
      }
    });
  });

  describe('カスタムモデル設定', () => {
    it('デフォルトモデル（gpt-4o）を使用する', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-130',
          choices: [
            {
              message: { role: 'assistant', content: 'Summary text' },
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

      await client.generateSummary(input);

      expect(mockPost).toHaveBeenCalledWith(
        '/chat/completions',
        expect.objectContaining({
          model: 'gpt-4o',
        })
      );
    });

    it('カスタムモデルを指定できる', async () => {
      vi.clearAllMocks();
      const customClient = new OpenAIClient({ apiKey: 'sk-test', model: 'gpt-4-turbo' });
      const mockAxiosCreate = axios.create as ReturnType<typeof vi.fn>;
      const mockInstance = mockAxiosCreate.mock.results[0]?.value as { post: ReturnType<typeof vi.fn> };
      const customMockPost = mockInstance.post;

      const mockResponse = {
        data: {
          id: 'chatcmpl-131',
          choices: [
            {
              message: { role: 'assistant', content: 'Summary text' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
        },
      };

      customMockPost.mockResolvedValueOnce(mockResponse);

      const input: SummaryInput = {
        commits: [],
        timeEntries: [],
        period: { start: '2026-01-27', end: '2026-02-02' },
      };

      await customClient.generateSummary(input);

      expect(customMockPost).toHaveBeenCalledWith(
        '/chat/completions',
        expect.objectContaining({
          model: 'gpt-4-turbo',
        })
      );
    });
  });

  describe('KPTサマリー生成のフォールバック', () => {
    it('OpenAI API障害時にデフォルトKPTを返す（フォールバック）', async () => {
      const error = new Error('Service error');
      Object.assign(error, {
        isAxiosError: true,
        response: { status: 503, data: {} },
      });

      // リトライ後も失敗
      mockPost.mockRejectedValue(error);

      const input: KPTInput = {
        weekSummary: 'Summary',
        highlights: ['highlight1'],
      };

      const result = await client.generateKPTSuggestions(input);

      // KPT生成はサービス障害時にはエラーを返す（フォールバックはActivityAnalyzer側）
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('SERVICE_UNAVAILABLE');
      }
    }, 30000);
  });
});
