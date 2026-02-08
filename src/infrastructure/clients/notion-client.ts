import axios, { AxiosInstance, isAxiosError } from 'axios';
import { Result, ok, err } from '../../types/result.js';

/**
 * Notion page content structure
 */
export interface NotionPageContent {
  readonly title: string;
  readonly properties: PageProperties;
  readonly blocks: readonly NotionBlock[];
}

/**
 * Page properties
 */
export interface PageProperties {
  readonly weekNumber: number;
  readonly dateRange: string;
  readonly tags: readonly string[];
  readonly prCount?: number;
  readonly workHours?: number;
  readonly aiEnabled?: boolean;
}

/**
 * Notion block types
 */
export type NotionBlock =
  | HeadingBlock
  | ParagraphBlock
  | BulletedListBlock
  | DividerBlock
  | ToggleBlock;

export interface HeadingBlock {
  readonly type: 'heading_1' | 'heading_2' | 'heading_3';
  readonly content: string;
}

export interface ParagraphBlock {
  readonly type: 'paragraph';
  readonly content: string;
}

export interface BulletedListBlock {
  readonly type: 'bulleted_list_item';
  readonly content: string;
}

export interface DividerBlock {
  readonly type: 'divider';
}

export interface ToggleBlock {
  readonly type: 'toggle';
  readonly title: string;
  readonly children: readonly NotionBlock[];
}

/**
 * Notion page result
 */
export interface NotionPage {
  readonly id: string;
  readonly url: string;
  readonly createdTime: string;
  readonly properties: Record<string, unknown>;
}

/**
 * Database query filter
 */
export interface DatabaseFilter {
  readonly property: string;
  readonly date?: {
    readonly after?: string;
    readonly before?: string;
  };
}

/**
 * Notion error types
 */
export type NotionError =
  | { readonly type: 'UNAUTHORIZED'; readonly message: string }
  | { readonly type: 'DATABASE_NOT_FOUND'; readonly databaseId: string }
  | { readonly type: 'VALIDATION_ERROR'; readonly message: string }
  | { readonly type: 'RATE_LIMITED'; readonly retryAfter: number }
  | { readonly type: 'SERVICE_UNAVAILABLE'; readonly message: string };

/**
 * Notion client configuration
 */
export interface NotionClientConfig {
  readonly token: string;
  readonly baseUrl?: string;
}

/**
 * Notion API Client
 */
export class NotionClient {
  private readonly client: AxiosInstance;
  private readonly maxRetries = 3;
  private readonly retryDelayMs = 1000;
  private readonly requestQueue: Array<() => Promise<unknown>> = [];
  private processing = false;

  constructor(config: NotionClientConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl || 'https://api.notion.com/v1',
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      timeout: 30000,
    });
  }

  /**
   * Create a page in a database
   */
  async createPage(
    content: NotionPageContent,
    databaseId: string
  ): Promise<Result<NotionPage, NotionError>> {
    try {
      const requestBody = this.buildCreatePageRequest(content, databaseId);

      const response = await this.executeWithRateLimit(() =>
        this.executeWithRetry(() =>
          this.client.post<NotionPageResponse>('/pages', requestBody)
        )
      );

      return ok({
        id: response.data.id,
        url: response.data.url,
        createdTime: response.data.created_time,
        properties: response.data.properties,
      });
    } catch (error) {
      return this.handleError(error, databaseId);
    }
  }

  /**
   * Query a database for pages
   */
  async queryDatabase(
    databaseId: string,
    filter?: DatabaseFilter
  ): Promise<Result<readonly NotionPage[], NotionError>> {
    try {
      const requestBody: Record<string, unknown> = {};

      if (filter) {
        requestBody.filter = this.buildFilter(filter);
      }

      requestBody.sorts = [
        { property: 'Created', direction: 'descending' },
      ];

      const response = await this.executeWithRateLimit(() =>
        this.executeWithRetry(() =>
          this.client.post<NotionQueryResponse>(`/databases/${databaseId}/query`, requestBody)
        )
      );

      return ok(
        response.data.results.map((page) => ({
          id: page.id,
          url: page.url,
          createdTime: page.created_time,
          properties: page.properties,
        }))
      );
    } catch (error) {
      return this.handleError(error, databaseId);
    }
  }

  /**
   * Get a page by ID
   */
  async getPage(pageId: string): Promise<Result<NotionPage, NotionError>> {
    try {
      const response = await this.executeWithRateLimit(() =>
        this.executeWithRetry(() =>
          this.client.get<NotionPageResponse>(`/pages/${pageId}`)
        )
      );

      return ok({
        id: response.data.id,
        url: response.data.url,
        createdTime: response.data.created_time,
        properties: response.data.properties,
      });
    } catch (error) {
      return this.handleError(error, pageId);
    }
  }

  private buildCreatePageRequest(
    content: NotionPageContent,
    databaseId: string
  ): NotionCreatePageRequest {
    return {
      parent: { database_id: databaseId },
      properties: this.buildProperties(content),
      children: this.buildBlocks(content.blocks),
    };
  }

  private buildProperties(content: NotionPageContent): Record<string, unknown> {
    const properties: Record<string, unknown> = {
      title: {
        title: [{ text: { content: content.title } }],
      },
    };

    // Week Number
    if (content.properties.weekNumber) {
      properties['Week Number'] = {
        number: content.properties.weekNumber,
      };
    }

    // Date Range (as rich text)
    if (content.properties.dateRange) {
      properties['Date Range'] = {
        rich_text: [{ text: { content: content.properties.dateRange } }],
      };
    }

    // Tags
    if (content.properties.tags.length > 0) {
      properties['Tags'] = {
        multi_select: content.properties.tags.map((tag) => ({ name: tag })),
      };
    }

    // PR Count
    if (content.properties.prCount !== undefined) {
      properties['PR Count'] = {
        number: content.properties.prCount,
      };
    }

    // Work Hours
    if (content.properties.workHours !== undefined) {
      properties['Work Hours'] = {
        number: content.properties.workHours,
      };
    }

    // AI Enabled
    if (content.properties.aiEnabled !== undefined) {
      properties['AI Enabled'] = {
        checkbox: content.properties.aiEnabled,
      };
    }

    return properties;
  }

  private buildBlocks(blocks: readonly NotionBlock[]): NotionBlockRequest[] {
    return blocks.map((block) => this.convertBlock(block));
  }

  private convertBlock(block: NotionBlock): NotionBlockRequest {
    switch (block.type) {
      case 'heading_1':
      case 'heading_2':
      case 'heading_3':
        return {
          object: 'block',
          type: block.type,
          [block.type]: {
            rich_text: [{ type: 'text', text: { content: block.content } }],
          },
        };

      case 'paragraph':
        return {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: block.content } }],
          },
        };

      case 'bulleted_list_item':
        return {
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [{ type: 'text', text: { content: block.content } }],
          },
        };

      case 'divider':
        return {
          object: 'block',
          type: 'divider',
          divider: {},
        };

      case 'toggle':
        return {
          object: 'block',
          type: 'toggle',
          toggle: {
            rich_text: [{ type: 'text', text: { content: block.title } }],
            children: this.buildBlocks(block.children),
          },
        };
    }
  }

  private buildFilter(filter: DatabaseFilter): Record<string, unknown> {
    if (filter.date) {
      const dateFilter: Record<string, unknown> = {};
      if (filter.date.after) {
        dateFilter.after = filter.date.after;
      }
      if (filter.date.before) {
        dateFilter.before = filter.date.before;
      }
      return {
        property: filter.property,
        date: dateFilter,
      };
    }
    return { property: filter.property };
  }

  private async executeWithRateLimit<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const task = async (): Promise<void> => {
        try {
          const result = await operation();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };

      this.requestQueue.push(task);
      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.requestQueue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.requestQueue.length > 0) {
      const task = this.requestQueue.shift();
      if (task) {
        await task();
        // Rate limit: 3 requests per second
        await this.sleep(340);
      }
    }

    this.processing = false;
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    retryCount = 0
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (retryCount < this.maxRetries && this.isRetryableError(error)) {
        const delay = this.retryDelayMs * Math.pow(2, retryCount);
        await this.sleep(delay);
        return this.executeWithRetry(operation, retryCount + 1);
      }
      throw error;
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (!isAxiosError(error)) {
      return false;
    }

    const status = error.response?.status;
    return (
      status === undefined ||
      status >= 500 ||
      status === 429 ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT'
    );
  }

  private handleError(error: unknown, resourceId: string): Result<never, NotionError> {
    if (!isAxiosError(error)) {
      return err({
        type: 'SERVICE_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    const status = error.response?.status;
    const data = error.response?.data as Record<string, unknown> | undefined;
    const message = (data?.message as string) || error.message;

    switch (status) {
      case 401:
        return err({
          type: 'UNAUTHORIZED',
          message,
        });

      case 404:
        return err({
          type: 'DATABASE_NOT_FOUND',
          databaseId: resourceId,
        });

      case 400:
        return err({
          type: 'VALIDATION_ERROR',
          message,
        });

      case 429: {
        const retryAfter = parseInt(
          error.response?.headers?.['retry-after'] as string,
          10
        ) || 60;
        return err({
          type: 'RATE_LIMITED',
          retryAfter,
        });
      }

      default:
        return err({
          type: 'SERVICE_UNAVAILABLE',
          message,
        });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Internal types for API requests/responses
interface NotionCreatePageRequest {
  parent: { database_id: string };
  properties: Record<string, unknown>;
  children: NotionBlockRequest[];
}

interface NotionBlockRequest {
  object: string;
  type: string;
  [key: string]: unknown;
}

interface NotionPageResponse {
  id: string;
  url: string;
  created_time: string;
  properties: Record<string, unknown>;
}

interface NotionQueryResponse {
  results: NotionPageResponse[];
  has_more: boolean;
  next_cursor: string | null;
}
