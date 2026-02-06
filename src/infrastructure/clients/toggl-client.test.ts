import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { TogglClient, DateRange } from './toggl-client.js';

// Mock axios
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

describe('TogglClient', () => {
  let client: TogglClient;
  let mockGet: ReturnType<typeof vi.fn>;

  const testDateRange: DateRange = {
    start: new Date('2026-01-27T00:00:00Z'),
    end: new Date('2026-02-02T23:59:59Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    client = new TogglClient({ apiToken: 'test_token_12345' });
    const mockAxiosCreate = axios.create as ReturnType<typeof vi.fn>;
    const mockInstance = mockAxiosCreate.mock.results[0]?.value as { get: ReturnType<typeof vi.fn> };
    mockGet = mockInstance.get;
  });

  describe('getTimeEntries', () => {
    it('should fetch time entries within date range', async () => {
      const mockEntries = [
        {
          id: 1,
          description: 'Working on feature',
          start: '2026-01-28T09:00:00Z',
          stop: '2026-01-28T12:00:00Z',
          duration: 10800,
          project_id: 123,
          workspace_id: 456,
          tags: ['coding'],
          billable: false,
        },
        {
          id: 2,
          description: 'Code review',
          start: '2026-01-28T14:00:00Z',
          stop: '2026-01-28T15:30:00Z',
          duration: 5400,
          project_id: null,
          workspace_id: 456,
          tags: [],
          billable: false,
        },
      ];

      mockGet.mockResolvedValueOnce({ data: mockEntries, headers: {} });

      const result = await client.getTimeEntries(testDateRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].description).toBe('Working on feature');
        expect(result.value[0].duration).toBe(10800);
        expect(result.value[0].projectId).toBe(123);
        expect(result.value[1].projectId).toBeNull();
      }
    });

    it('should filter out running entries (negative duration)', async () => {
      const mockEntries = [
        {
          id: 1,
          description: 'Completed work',
          start: '2026-01-28T09:00:00Z',
          stop: '2026-01-28T12:00:00Z',
          duration: 10800,
          project_id: 123,
          workspace_id: 456,
          tags: [],
          billable: false,
        },
        {
          id: 2,
          description: 'Currently running',
          start: '2026-01-28T14:00:00Z',
          stop: null,
          duration: -1706446800, // Negative means running
          project_id: 123,
          workspace_id: 456,
          tags: [],
          billable: false,
        },
      ];

      mockGet.mockResolvedValueOnce({ data: mockEntries, headers: {} });

      const result = await client.getTimeEntries(testDateRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].description).toBe('Completed work');
      }
    });

    it('should handle empty entries', async () => {
      mockGet.mockResolvedValueOnce({ data: [], headers: {} });

      const result = await client.getTimeEntries(testDateRange);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(0);
      }
    });

    it('should return UNAUTHORIZED error for 401 response', async () => {
      const error = new Error('Unauthorized');
      Object.assign(error, {
        isAxiosError: true,
        response: { status: 401, data: {} },
      });

      mockGet.mockRejectedValueOnce(error);

      const result = await client.getTimeEntries(testDateRange);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('UNAUTHORIZED');
      }
    });

    it('should return RATE_LIMITED error for 429 response after retries', async () => {
      const error = new Error('Rate limited');
      Object.assign(error, {
        isAxiosError: true,
        response: { status: 429, headers: { 'retry-after': '60' } },
      });

      // Mock multiple failures to exhaust retries
      mockGet.mockRejectedValue(error);

      const result = await client.getTimeEntries(testDateRange);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.type).toBe('RATE_LIMITED');
        if (result.error.type === 'RATE_LIMITED') {
          expect(result.error.retryAfter).toBe(60);
        }
      }
    }, 30000);
  });

  describe('getProjects', () => {
    it('should fetch projects for a workspace', async () => {
      const mockProjects = [
        {
          id: 123,
          name: 'Project A',
          workspace_id: 456,
          color: '#FF0000',
          active: true,
        },
        {
          id: 124,
          name: 'Project B',
          workspace_id: 456,
          color: '#00FF00',
          active: true,
        },
      ];

      mockGet.mockResolvedValueOnce({ data: mockProjects, headers: {} });

      const result = await client.getProjects(456);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0].name).toBe('Project A');
        expect(result.value[1].name).toBe('Project B');
      }
    });
  });

  describe('getTimeEntriesWithProjectNames', () => {
    it('should resolve project names for entries', async () => {
      const mockEntries = [
        {
          id: 1,
          description: 'Working on feature',
          start: '2026-01-28T09:00:00Z',
          stop: '2026-01-28T12:00:00Z',
          duration: 10800,
          project_id: 123,
          workspace_id: 456,
          tags: [],
          billable: false,
        },
      ];

      const mockProjects = [
        {
          id: 123,
          name: 'Project Alpha',
          workspace_id: 456,
          color: '#FF0000',
          active: true,
        },
      ];

      mockGet
        .mockResolvedValueOnce({ data: mockEntries, headers: {} })
        .mockResolvedValueOnce({ data: mockProjects, headers: {} });

      const result = await client.getTimeEntriesWithProjectNames(testDateRange, 456);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value[0].projectName).toBe('Project Alpha');
      }
    });

    it('should handle entries without project', async () => {
      const mockEntries = [
        {
          id: 1,
          description: 'No project work',
          start: '2026-01-28T09:00:00Z',
          stop: '2026-01-28T12:00:00Z',
          duration: 10800,
          project_id: null,
          workspace_id: 456,
          tags: [],
          billable: false,
        },
      ];

      mockGet
        .mockResolvedValueOnce({ data: mockEntries, headers: {} })
        .mockResolvedValueOnce({ data: [], headers: {} });

      const result = await client.getTimeEntriesWithProjectNames(testDateRange, 456);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value[0].projectName).toBe('No Project');
      }
    });
  });
});
