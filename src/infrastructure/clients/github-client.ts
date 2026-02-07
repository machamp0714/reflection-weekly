import axios, { AxiosInstance, isAxiosError } from 'axios';
import { Result, ok, err } from '../../types/result.js';

/**
 * Date range for filtering commits
 */
export interface DateRange {
  readonly start: Date;
  readonly end: Date;
}

/**
 * GitHub commit data
 */
export interface GitHubCommit {
  readonly sha: string;
  readonly message: string;
  readonly author: {
    readonly name: string;
    readonly email: string;
    readonly date: string;
  };
  readonly url: string;
  readonly stats?: {
    readonly additions: number;
    readonly deletions: number;
    readonly total: number;
  };
}

/**
 * Commit stats
 */
export interface CommitStats {
  readonly additions: number;
  readonly deletions: number;
  readonly filesChanged: number;
}

/**
 * File change detail with optional patch
 */
export interface FileChange {
  readonly filename: string;
  readonly status: string;
  readonly additions: number;
  readonly deletions: number;
  readonly patch?: string;
}

/**
 * Commit detail with file changes and patches
 */
export interface CommitDetail {
  readonly sha: string;
  readonly message: string;
  readonly author: {
    readonly name: string;
    readonly email: string;
    readonly date: string;
  };
  readonly stats: CommitStats;
  readonly files: readonly FileChange[];
}

/**
 * Options for getCommits
 */
export interface GetCommitsOptions {
  readonly author?: string;
  readonly perPage?: number;
}

/**
 * GitHub error types
 */
export type GitHubError =
  | { readonly type: 'UNAUTHORIZED'; readonly message: string }
  | { readonly type: 'RATE_LIMITED'; readonly resetAt: Date }
  | { readonly type: 'NOT_FOUND'; readonly repository: string }
  | { readonly type: 'NETWORK_ERROR'; readonly message: string };

/**
 * GitHub client configuration
 */
export interface GitHubClientConfig {
  readonly token: string;
  readonly baseUrl?: string;
}

/**
 * Raw GitHub API commit response
 */
interface RawGitHubCommit {
  sha: string;
  commit: {
    message: string;
    author: {
      name: string;
      email: string;
      date: string;
    };
  };
  html_url: string;
  stats?: {
    additions: number;
    deletions: number;
    total: number;
  };
  files?: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
}

/**
 * GitHub REST API Client
 */
export class GitHubClient {
  private readonly client: AxiosInstance;
  private readonly maxRetries = 3;
  private readonly retryDelayMs = 1000;

  constructor(config: GitHubClientConfig) {
    this.client = axios.create({
      baseURL: config.baseUrl || 'https://api.github.com',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      timeout: 30000,
    });
  }

  /**
   * Get commits for a repository within a date range
   */
  async getCommits(
    repository: string,
    dateRange: DateRange,
    options?: GetCommitsOptions
  ): Promise<Result<readonly GitHubCommit[], GitHubError>> {
    // Validate repository format
    if (!this.isValidRepositoryFormat(repository)) {
      return err({
        type: 'NOT_FOUND',
        repository,
      });
    }

    const [owner, repo] = repository.split('/');
    const allCommits: GitHubCommit[] = [];
    let page = 1;
    const perPage = options?.perPage || 100;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await this.fetchCommitsPage(
        owner,
        repo,
        dateRange,
        page,
        perPage,
        options?.author
      );

      if (!result.success) {
        return result;
      }

      const { commits, hasNextPage } = result.value;
      allCommits.push(...commits);

      if (!hasNextPage || commits.length < perPage) {
        break;
      }

      page++;
    }

    return ok(allCommits);
  }

  /**
   * Get commit stats for a specific commit
   */
  async getCommitStats(
    repository: string,
    sha: string
  ): Promise<Result<CommitStats, GitHubError>> {
    if (!this.isValidRepositoryFormat(repository)) {
      return err({
        type: 'NOT_FOUND',
        repository,
      });
    }

    const [owner, repo] = repository.split('/');

    try {
      const response = await this.executeWithRetry(() =>
        this.client.get<RawGitHubCommit>(`/repos/${owner}/${repo}/commits/${sha}`)
      );

      const commit = response.data;
      return ok({
        additions: commit.stats?.additions || 0,
        deletions: commit.stats?.deletions || 0,
        filesChanged: commit.files?.length || 0,
      });
    } catch (error) {
      return this.handleError(error, repository);
    }
  }

  /**
   * Get full commit detail including file changes and patches
   */
  async getCommitDetail(
    repository: string,
    sha: string
  ): Promise<Result<CommitDetail, GitHubError>> {
    if (!this.isValidRepositoryFormat(repository)) {
      return err({
        type: 'NOT_FOUND',
        repository,
      });
    }

    const [owner, repo] = repository.split('/');

    try {
      const response = await this.executeWithRetry(() =>
        this.client.get<RawGitHubCommit>(`/repos/${owner}/${repo}/commits/${sha}`)
      );

      const raw = response.data;
      return ok({
        sha: raw.sha,
        message: raw.commit.message,
        author: raw.commit.author,
        stats: {
          additions: raw.stats?.additions || 0,
          deletions: raw.stats?.deletions || 0,
          filesChanged: raw.files?.length || 0,
        },
        files: (raw.files || []).map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          patch: f.patch,
        })),
      });
    } catch (error) {
      return this.handleError(error, repository);
    }
  }

  private async fetchCommitsPage(
    owner: string,
    repo: string,
    dateRange: DateRange,
    page: number,
    perPage: number,
    author?: string
  ): Promise<Result<{ commits: GitHubCommit[]; hasNextPage: boolean }, GitHubError>> {
    try {
      const response = await this.executeWithRetry(() =>
        this.client.get<RawGitHubCommit[]>(`/repos/${owner}/${repo}/commits`, {
          params: {
            since: dateRange.start.toISOString(),
            until: dateRange.end.toISOString(),
            per_page: perPage,
            page,
            ...(author ? { author } : {}),
          },
        })
      );

      const commits = response.data.map((raw) => this.mapCommit(raw));
      const linkHeader = response.headers['link'] as string | undefined;
      const hasNextPage = linkHeader?.includes('rel="next"') || false;

      return ok({ commits, hasNextPage });
    } catch (error) {
      return this.handleError(error, `${owner}/${repo}`);
    }
  }

  private mapCommit(raw: RawGitHubCommit): GitHubCommit {
    return {
      sha: raw.sha,
      message: raw.commit.message,
      author: {
        name: raw.commit.author.name,
        email: raw.commit.author.email,
        date: raw.commit.author.date,
      },
      url: raw.html_url,
      stats: raw.stats
        ? {
            additions: raw.stats.additions,
            deletions: raw.stats.deletions,
            total: raw.stats.total,
          }
        : undefined,
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
    // Retry on 5xx errors and some specific 4xx errors
    return (
      status === undefined ||
      status >= 500 ||
      status === 429 ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT'
    );
  }

  private handleError(error: unknown, repository: string): Result<never, GitHubError> {
    if (!isAxiosError(error)) {
      return err({
        type: 'NETWORK_ERROR',
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

      case 403:
        if (message.includes('rate limit')) {
          const resetHeader = error.response?.headers?.['x-ratelimit-reset'] as string | undefined;
          const resetTime = resetHeader
            ? new Date(parseInt(resetHeader, 10) * 1000)
            : new Date(Date.now() + 3600000);
          return err({
            type: 'RATE_LIMITED',
            resetAt: resetTime,
          });
        }
        return err({
          type: 'UNAUTHORIZED',
          message,
        });

      case 404:
        return err({
          type: 'NOT_FOUND',
          repository,
        });

      default:
        return err({
          type: 'NETWORK_ERROR',
          message,
        });
    }
  }

  private isValidRepositoryFormat(repository: string): boolean {
    const parts = repository.split('/');
    return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
