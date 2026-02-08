import axios, { AxiosInstance, isAxiosError } from 'axios';
import { Result, ok, err } from '../../types/result.js';

/**
 * Date range for filtering pull requests
 */
export interface DateRange {
  readonly start: Date;
  readonly end: Date;
}

/**
 * GitHub Pull Request data
 */
export interface GitHubPullRequest {
  readonly number: number;
  readonly title: string;
  readonly body: string | null;
  readonly user: {
    readonly login: string;
  };
  readonly createdAt: string;
  readonly url: string;
  readonly htmlUrl: string;
  readonly state: 'open' | 'closed';
  readonly merged: boolean;
}

/**
 * Options for getPullRequests
 */
export interface GetPullRequestsOptions {
  readonly state?: 'open' | 'closed' | 'all';
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
 * Raw GitHub API pull request response
 */
interface RawGitHubPullRequest {
  number: number;
  title: string;
  body: string | null;
  user: {
    login: string;
  };
  created_at: string;
  url: string;
  html_url: string;
  state: 'open' | 'closed';
  merged_at: string | null;
}

/**
 * GitHub REST API Client - Pull Requests
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
   * Get pull requests for a repository within a date range
   */
  async getPullRequests(
    repository: string,
    dateRange: DateRange,
    options?: GetPullRequestsOptions
  ): Promise<Result<readonly GitHubPullRequest[], GitHubError>> {
    // Validate repository format
    if (!this.isValidRepositoryFormat(repository)) {
      return err({
        type: 'NOT_FOUND',
        repository,
      });
    }

    const [owner, repo] = repository.split('/');
    const allPRs: GitHubPullRequest[] = [];
    let page = 1;
    const perPage = options?.perPage || 100;
    const state = options?.state || 'all';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await this.fetchPullRequestsPage(
        owner,
        repo,
        state,
        page,
        perPage
      );

      if (!result.success) {
        return result;
      }

      const { pullRequests, hasNextPage } = result.value;

      // Filter PRs by date range (client-side filtering since Pulls API doesn't support since/until)
      for (const pr of pullRequests) {
        const createdAt = new Date(pr.createdAt);
        if (createdAt >= dateRange.start && createdAt <= dateRange.end) {
          allPRs.push(pr);
        }
      }

      // Stop pagination if we've gone past the date range (PRs sorted by created desc)
      // If the oldest PR on this page is before the start date, no need to fetch more
      if (pullRequests.length > 0) {
        const oldestPR = pullRequests[pullRequests.length - 1];
        const oldestCreatedAt = new Date(oldestPR.createdAt);
        if (oldestCreatedAt < dateRange.start) {
          break;
        }
      }

      if (!hasNextPage || pullRequests.length < perPage) {
        break;
      }

      page++;
    }

    return ok(allPRs);
  }

  private async fetchPullRequestsPage(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all',
    page: number,
    perPage: number
  ): Promise<Result<{ pullRequests: GitHubPullRequest[]; hasNextPage: boolean }, GitHubError>> {
    try {
      const response = await this.executeWithRetry(() =>
        this.client.get<RawGitHubPullRequest[]>(`/repos/${owner}/${repo}/pulls`, {
          params: {
            state,
            sort: 'created',
            direction: 'desc',
            per_page: perPage,
            page,
          },
        })
      );

      const pullRequests = response.data.map((raw) => this.mapPullRequest(raw));
      const linkHeader = response.headers['link'] as string | undefined;
      const hasNextPage = linkHeader?.includes('rel="next"') || false;

      return ok({ pullRequests, hasNextPage });
    } catch (error) {
      return this.handleError(error, `${owner}/${repo}`);
    }
  }

  private mapPullRequest(raw: RawGitHubPullRequest): GitHubPullRequest {
    return {
      number: raw.number,
      title: raw.title,
      body: raw.body,
      user: {
        login: raw.user.login,
      },
      createdAt: raw.created_at,
      url: raw.url,
      htmlUrl: raw.html_url,
      state: raw.state,
      merged: raw.merged_at !== null,
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
