import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { NotionClient, NotionPageContent } from './notion-client.js';

// Mock axios
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: vi.fn(() => ({
        post: vi.fn(),
        get: vi.fn(),
        interceptors: {
          request: { use: vi.fn() },
          response: { use: vi.fn() },
        },
      })),
    },
  };
});

describe('NotionClient', () => {
  let client: NotionClient;
  let mockPost: ReturnType<typeof vi.fn>;
  let mockGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new NotionClient({ token: 'secret_notion_token_12345' });
    const mockAxiosCreate = axios.create as ReturnType<typeof vi.fn>;
    const mockInstance = mockAxiosCreate.mock.results[0]?.value as {
      post: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
    };
    mockPost = mockInstance.post;
    mockGet = mockInstance.get;
  });

  describe('createPage', () => {
    it('should create a page in the database', async () => {
      const mockResponse = {
        data: {
          id: 'page-123',
          url: 'https://notion.so/page-123',
          created_time: '2026-02-06T10:00:00Z',
          properties: { title: { title: [{ text: { content: 'Test Page' } }] } },
        },
      };

      mockPost.mockResolvedValueOnce(mockResponse);

      const content: NotionPageContent = {
        title: 'Week 5: 2026-01-27 - 2026-02-02',
        properties: {
          weekNumber: 5,
          dateRange: '2026-01-27 - 2026-02-02',
          tags: ['weekly-reflection', 'auto-generated'],
          prCount: 25,
          workHours: 40,
          aiEnabled: true,
        },
        blocks: [
          { type: 'heading_1', content: 'Weekly Summary' },
          { type: 'paragraph', content: 'This week was productive.' },
          { type: 'heading_2', content: 'KPT' },
          { type: 'heading_3', content: 'Keep' },
          { type: 'bulleted_list_item', content: 'Regular PRs' },
          { type: 'divider' },
        ],
      };

      const result = await client.createPage(content, 'database-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.id).toBe('page-123');
        expect(result.value.url).toBe('https://notion.so/page-123');
      }

      // プロパティのマッピングを検証
      const requestBody = mockPost.mock.calls[0][1];
      expect(requestBody.properties['日付']).toEqual({
        date: { start: '2026-01-27', end: '2026-02-02' },
      });
      expect(requestBody.properties['作業時間']).toEqual({ number: 40 });
      // 存在しないプロパティは送信されない
      expect(requestBody.properties['コミット数']).toBeUndefined();
      expect(requestBody.properties['Week Number']).toBeUndefined();
      expect(requestBody.properties['Tags']).toBeUndefined();
      expect(requestBody.properties['AI Enabled']).toBeUndefined();
    });

    it('should handle toggle blocks with children', async () => {
      const mockResponse = {
        data: {
          id: 'page-456',
          url: 'https://notion.so/page-456',
          created_time: '2026-02-06T10:00:00Z',
          properties: {},
        },
      };

      mockPost.mockResolvedValueOnce(mockResponse);

      const content: NotionPageContent = {
        title: 'Test Page',
        properties: {
          weekNumber: 5,
          dateRange: '2026-01-27 - 2026-02-02',
          tags: [],
        },
        blocks: [
          {
            type: 'toggle',
            title: 'Commit Details',
            children: [
              { type: 'bulleted_list_item', content: 'feat: add feature' },
              { type: 'bulleted_list_item', content: 'fix: bug fix' },
            ],
          },
        ],
      };

      const result = await client.createPage(content, 'database-123');

      expect(result.success).toBe(true);
      expect(mockPost).toHaveBeenCalledWith(
        '/pages',
        expect.objectContaining({
          children: expect.arrayContaining([
            expect.objectContaining({
              type: 'toggle',
            }),
          ]),
        })
      );
    });

    it('should return DATABASE_NOT_FOUND for 404 response', async () => {
      const error = new Error('Not found');
      Object.assign(error, {
        isAxiosError: true,
        response: { status: 404, data: { message: 'Database not found' } },
      });

      mockPost.mockRejectedValueOnce(error);

      const content: NotionPageContent = {
        title: 'Test',
        properties: { weekNumber: 1, dateRange: '', tags: [] },
        blocks: [],
      };

      const result = await client.createPage(content, 'invalid-database');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('DATABASE_NOT_FOUND');
      }
    });

    it('should return VALIDATION_ERROR for 400 response', async () => {
      const error = new Error('Validation error');
      Object.assign(error, {
        isAxiosError: true,
        response: { status: 400, data: { message: 'Invalid property' } },
      });

      mockPost.mockRejectedValueOnce(error);

      const content: NotionPageContent = {
        title: 'Test',
        properties: { weekNumber: 1, dateRange: '', tags: [] },
        blocks: [],
      };

      const result = await client.createPage(content, 'database-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('VALIDATION_ERROR');
      }
    });

    it('should return UNAUTHORIZED for 401 response', async () => {
      const error = new Error('Unauthorized');
      Object.assign(error, {
        isAxiosError: true,
        response: { status: 401, data: { message: 'Invalid token' } },
      });

      mockPost.mockRejectedValueOnce(error);

      const content: NotionPageContent = {
        title: 'Test',
        properties: { weekNumber: 1, dateRange: '', tags: [] },
        blocks: [],
      };

      const result = await client.createPage(content, 'database-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('UNAUTHORIZED');
      }
    });
  });

  describe('queryDatabase', () => {
    it('should query database for pages', async () => {
      const mockResponse = {
        data: {
          results: [
            {
              id: 'page-1',
              url: 'https://notion.so/page-1',
              created_time: '2026-02-01T10:00:00Z',
              properties: {},
            },
            {
              id: 'page-2',
              url: 'https://notion.so/page-2',
              created_time: '2026-01-25T10:00:00Z',
              properties: {},
            },
          ],
          has_more: false,
          next_cursor: null,
        },
      };

      mockPost.mockResolvedValueOnce(mockResponse);

      const result = await client.queryDatabase('database-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].id).toBe('page-1');
      }
    });

    it('should query with date filter', async () => {
      const mockResponse = {
        data: {
          results: [],
          has_more: false,
          next_cursor: null,
        },
      };

      mockPost.mockResolvedValueOnce(mockResponse);

      await client.queryDatabase('database-123', {
        property: 'Created',
        date: { after: '2026-01-27' },
      });

      expect(mockPost).toHaveBeenCalledWith(
        '/databases/database-123/query',
        expect.objectContaining({
          filter: expect.objectContaining({
            property: 'Created',
            date: { after: '2026-01-27' },
          }),
        })
      );
    });
  });

  describe('getPage', () => {
    it('should get a page by ID', async () => {
      const mockResponse = {
        data: {
          id: 'page-123',
          url: 'https://notion.so/page-123',
          created_time: '2026-02-06T10:00:00Z',
          properties: {},
        },
      };

      mockGet.mockResolvedValueOnce(mockResponse);

      const result = await client.getPage('page-123');

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.id).toBe('page-123');
      }
    });
  });

  describe('RATE_LIMITEDエラー', () => {
    it('429レスポンスの場合RATE_LIMITEDエラーを返す', async () => {
      const error = new Error('Too Many Requests');
      Object.assign(error, {
        isAxiosError: true,
        response: {
          status: 429,
          data: { message: 'Rate limit exceeded' },
          headers: { 'retry-after': '30' },
        },
      });

      // リトライ後も失敗
      mockPost.mockRejectedValue(error);

      const content: NotionPageContent = {
        title: 'Test',
        properties: { weekNumber: 1, dateRange: '', tags: [] },
        blocks: [],
      };

      const result = await client.createPage(content, 'database-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('RATE_LIMITED');
        if (result.error.type === 'RATE_LIMITED') {
          expect(result.error.retryAfter).toBe(30);
        }
      }
    }, 30000);
  });

  describe('SERVICE_UNAVAILABLEエラー', () => {
    it('500レスポンスの場合SERVICE_UNAVAILABLEエラーを返す', async () => {
      const error = new Error('Internal Server Error');
      Object.assign(error, {
        isAxiosError: true,
        response: { status: 500, data: { message: 'Internal error' } },
      });

      // リトライ後も失敗
      mockPost.mockRejectedValue(error);

      const content: NotionPageContent = {
        title: 'Test',
        properties: { weekNumber: 1, dateRange: '', tags: [] },
        blocks: [],
      };

      const result = await client.createPage(content, 'database-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('SERVICE_UNAVAILABLE');
      }
    }, 30000);

    it('非Axiosエラーの場合SERVICE_UNAVAILABLEを返す', async () => {
      const genericError = new Error('Unexpected failure');

      mockPost.mockRejectedValueOnce(genericError);

      const content: NotionPageContent = {
        title: 'Test',
        properties: { weekNumber: 1, dateRange: '', tags: [] },
        blocks: [],
      };

      const result = await client.createPage(content, 'database-123');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('SERVICE_UNAVAILABLE');
        expect(result.error.message).toBe('Unexpected failure');
      }
    });
  });

  describe('Markdownフォールバック', () => {
    it('Notion API障害時にcreatePageがエラーを返す（フォールバックはPageBuilder側）', async () => {
      const error = new Error('Service Unavailable');
      Object.assign(error, {
        isAxiosError: true,
        response: { status: 503, data: { message: 'Service down' } },
      });

      // リトライ後も失敗
      mockPost.mockRejectedValue(error);

      const content: NotionPageContent = {
        title: 'Week 5: 2026-01-27 - 2026-02-02',
        properties: {
          weekNumber: 5,
          dateRange: '2026-01-27 - 2026-02-02',
          tags: ['weekly-reflection'],
          prCount:10,
          workHours: 35,
          aiEnabled: true,
        },
        blocks: [
          { type: 'heading_1', content: 'Weekly Summary' },
          { type: 'paragraph', content: 'This week was productive.' },
        ],
      };

      const result = await client.createPage(content, 'database-123');

      expect(result.success).toBe(false);
      // エラーが返されることで、PageBuilder側がMarkdownフォールバックを実行可能
      if (!result.success) {
        expect(result.error.type).toBe('SERVICE_UNAVAILABLE');
      }
    }, 30000);
  });

  describe('queryDatabaseエラーハンドリング', () => {
    it('queryDatabaseで404の場合DATABASE_NOT_FOUNDを返す', async () => {
      const error = new Error('Not found');
      Object.assign(error, {
        isAxiosError: true,
        response: { status: 404, data: { message: 'Database not found' } },
      });

      mockPost.mockRejectedValueOnce(error);

      const result = await client.queryDatabase('invalid-db-id');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('DATABASE_NOT_FOUND');
      }
    });
  });
});
