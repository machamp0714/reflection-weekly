import axios, { AxiosInstance, isAxiosError } from 'axios';
import { Result, ok, err } from '../../types/result.js';

/**
 * Date range for filtering time entries
 */
export interface DateRange {
  readonly start: Date;
  readonly end: Date;
}

/**
 * Toggl time entry data
 */
export interface TogglTimeEntry {
  readonly id: number;
  readonly description: string;
  readonly start: string;
  readonly stop: string | null;
  readonly duration: number;
  readonly projectId: number | null;
  readonly workspaceId: number;
  readonly tags: readonly string[];
  readonly billable: boolean;
}

/**
 * Toggl project data
 */
export interface TogglProject {
  readonly id: number;
  readonly name: string;
  readonly workspaceId: number;
  readonly color: string;
  readonly active: boolean;
}

/**
 * Toggl error types
 */
export type TogglError =
  | { readonly type: 'UNAUTHORIZED'; readonly message: string }
  | { readonly type: 'RATE_LIMITED'; readonly retryAfter: number }
  | { readonly type: 'NETWORK_ERROR'; readonly message: string };

/**
 * Toggl client configuration
 */
export interface TogglClientConfig {
  readonly apiToken: string;
  readonly baseUrl?: string;
}

/**
 * Raw Toggl API time entry response
 */
interface RawTogglTimeEntry {
  id: number;
  description: string | null;
  start: string;
  stop: string | null;
  duration: number;
  project_id: number | null;
  workspace_id: number;
  tags: string[] | null;
  billable: boolean;
}

/**
 * Raw Toggl API project response
 */
interface RawTogglProject {
  id: number;
  name: string;
  workspace_id: number;
  color: string;
  active: boolean;
}

/**
 * Toggl Track API v9 Client
 */
export class TogglClient {
  private readonly client: AxiosInstance;
  private readonly projectCache: Map<number, TogglProject> = new Map();
  private readonly maxRetries = 3;
  private readonly retryDelayMs = 1000;

  constructor(config: TogglClientConfig) {
    // Toggl uses Basic auth with email:api_token or api_token:api_token
    const authString = Buffer.from(`${config.apiToken}:api_token`).toString('base64');

    this.client = axios.create({
      baseURL: config.baseUrl || 'https://api.track.toggl.com/api/v9',
      headers: {
        Authorization: `Basic ${authString}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  /**
   * Get time entries within a date range
   */
  async getTimeEntries(
    dateRange: DateRange
  ): Promise<Result<readonly TogglTimeEntry[], TogglError>> {
    try {
      const response = await this.executeWithRetry(() =>
        this.client.get<RawTogglTimeEntry[]>('/me/time_entries', {
          params: {
            start_date: dateRange.start.toISOString(),
            end_date: dateRange.end.toISOString(),
          },
        })
      );

      // Filter out running entries (duration is negative)
      const completedEntries = response.data.filter((entry) => entry.duration >= 0);

      return ok(completedEntries.map((entry) => this.mapTimeEntry(entry)));
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get projects for a workspace
   */
  async getProjects(workspaceId: number): Promise<Result<readonly TogglProject[], TogglError>> {
    try {
      const response = await this.executeWithRetry(() =>
        this.client.get<RawTogglProject[]>(`/workspaces/${workspaceId}/projects`)
      );

      const projects = response.data.map((project) => this.mapProject(project));

      // Cache projects for later use
      projects.forEach((project) => {
        this.projectCache.set(project.id, project);
      });

      return ok(projects);
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Get project name by ID (uses cache if available)
   */
  async getProjectName(
    projectId: number,
    workspaceId: number
  ): Promise<Result<string, TogglError>> {
    // Check cache first
    const cached = this.projectCache.get(projectId);
    if (cached) {
      return ok(cached.name);
    }

    // Load projects to populate cache
    const result = await this.getProjects(workspaceId);
    if (!result.success) {
      return result;
    }

    const project = this.projectCache.get(projectId);
    if (project) {
      return ok(project.name);
    }

    return ok('Unknown Project');
  }

  /**
   * Get time entries with project names resolved
   */
  async getTimeEntriesWithProjectNames(
    dateRange: DateRange,
    workspaceId?: number
  ): Promise<
    Result<
      readonly (TogglTimeEntry & { readonly projectName: string })[],
      TogglError
    >
  > {
    const entriesResult = await this.getTimeEntries(dateRange);
    if (!entriesResult.success) {
      return entriesResult;
    }

    const entries = entriesResult.value;

    // Get unique workspace IDs
    const workspaceIds = new Set(
      workspaceId
        ? [workspaceId]
        : entries.map((e) => e.workspaceId)
    );

    // Load projects for each workspace
    for (const wsId of workspaceIds) {
      await this.getProjects(wsId);
    }

    // Map entries with project names
    const entriesWithNames = entries.map((entry) => ({
      ...entry,
      projectName: entry.projectId
        ? this.projectCache.get(entry.projectId)?.name || 'Unknown Project'
        : 'No Project',
    }));

    return ok(entriesWithNames);
  }

  private mapTimeEntry(raw: RawTogglTimeEntry): TogglTimeEntry {
    return {
      id: raw.id,
      description: raw.description || '',
      start: raw.start,
      stop: raw.stop,
      duration: raw.duration,
      projectId: raw.project_id,
      workspaceId: raw.workspace_id,
      tags: raw.tags || [],
      billable: raw.billable,
    };
  }

  private mapProject(raw: RawTogglProject): TogglProject {
    return {
      id: raw.id,
      name: raw.name,
      workspaceId: raw.workspace_id,
      color: raw.color,
      active: raw.active,
    };
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

  private handleError(error: unknown): Result<never, TogglError> {
    if (!isAxiosError(error)) {
      return err({
        type: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    const status = error.response?.status;

    switch (status) {
      case 401:
      case 403:
        return err({
          type: 'UNAUTHORIZED',
          message: 'Invalid API token',
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
          type: 'NETWORK_ERROR',
          message: error.message,
        });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
