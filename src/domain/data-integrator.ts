import { Result, ok, err } from '../types/result.js';
import type { GitHubPullRequest } from '../infrastructure/clients/github-client.js';
import type { TogglTimeEntry } from '../infrastructure/clients/toggl-client.js';

/**
 * Date range for data collection
 */
export interface DateRange {
  readonly start: Date;
  readonly end: Date;
}

/**
 * Data source configuration
 */
export interface DataSourceConfig {
  readonly repositories: readonly string[];
  readonly workspaceId?: number;
}

/**
 * Pull request data in domain format
 */
export interface PullRequestData {
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly createdAt: Date;
  readonly repository: string;
  readonly url: string;
  readonly state: 'open' | 'closed' | 'merged';
}

/**
 * Time entry data in domain format
 */
export interface TimeEntryData {
  readonly id: number;
  readonly description: string;
  readonly projectName: string;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly durationSeconds: number;
  readonly tags: readonly string[];
}

/**
 * Daily summary
 */
export interface DailySummary {
  readonly date: Date;
  readonly prCount: number;
  readonly workHours: number;
  readonly projects: readonly string[];
}

/**
 * Project summary
 */
export interface ProjectSummary {
  readonly projectName: string;
  readonly totalPRs: number;
  readonly totalWorkHours: number;
}

/**
 * Data warning types
 */
export type DataWarning =
  | { readonly type: 'NO_PULL_REQUESTS'; readonly message: string }
  | { readonly type: 'NO_TIME_ENTRIES'; readonly message: string }
  | { readonly type: 'PARTIAL_DATA'; readonly source: string; readonly message: string };

/**
 * Data collection error
 */
export type DataCollectionError = {
  readonly type: 'ALL_SOURCES_FAILED';
  readonly errors: readonly SourceError[];
};

/**
 * Source error
 */
export interface SourceError {
  readonly source: 'github' | 'toggl';
  readonly message: string;
}

/**
 * Integrated data from all sources
 */
export interface IntegratedData {
  readonly dateRange: DateRange;
  readonly pullRequests: readonly PullRequestData[];
  readonly timeEntries: readonly TimeEntryData[];
  readonly dailySummaries: readonly DailySummary[];
  readonly projectSummaries: readonly ProjectSummary[];
  readonly warnings: readonly DataWarning[];
}

/**
 * GitHub client interface for dependency injection
 */
export interface IGitHubClient {
  getPullRequests(
    repository: string,
    dateRange: DateRange,
    options?: { readonly state?: 'open' | 'closed' | 'all'; readonly perPage?: number }
  ): Promise<Result<readonly GitHubPullRequest[], { readonly type: string; readonly message?: string; readonly repository?: string; readonly resetAt?: Date }>>;
}

/**
 * Toggl client interface for dependency injection
 */
export interface ITogglClient {
  getTimeEntriesWithProjectNames(
    dateRange: DateRange,
    workspaceId?: number
  ): Promise<Result<readonly (TogglTimeEntry & { readonly projectName: string })[], { readonly type: string; readonly message?: string; readonly retryAfter?: number }>>;
}

/**
 * DataIntegrator - GitHubとTogglからのデータ収集と時系列統合
 *
 * Responsibilities:
 * - 複数データソースからの並列データ取得
 * - 時系列でのデータ統合とプロジェクト別集計
 * - データソースエラー時のグレースフル継続
 */
export class DataIntegrator {
  constructor(
    private readonly githubClient: IGitHubClient,
    private readonly togglClient: ITogglClient
  ) {}

  /**
   * Collect data from all sources and integrate
   */
  async collectAndIntegrate(
    dateRange: DateRange,
    config: DataSourceConfig
  ): Promise<Result<IntegratedData, DataCollectionError>> {
    const warnings: DataWarning[] = [];
    const errors: SourceError[] = [];

    // Parallel collection from GitHub and Toggl
    const [prsResult, timeEntriesResult] = await Promise.all([
      this.collectGitHubPullRequests(dateRange, config.repositories),
      this.collectTogglTimeEntries(dateRange, config.workspaceId),
    ]);

    // Process GitHub results
    let pullRequests: PullRequestData[] = [];
    if (prsResult.success) {
      pullRequests = prsResult.value;
      if (pullRequests.length === 0) {
        warnings.push({
          type: 'NO_PULL_REQUESTS',
          message: '該当期間のPRはありません',
        });
      }
    } else {
      errors.push({ source: 'github', message: prsResult.error });
      warnings.push({
        type: 'PARTIAL_DATA',
        source: 'github',
        message: `GitHubデータの取得に失敗しました: ${prsResult.error}`,
      });
    }

    // Process Toggl results
    let timeEntries: TimeEntryData[] = [];
    if (timeEntriesResult.success) {
      timeEntries = timeEntriesResult.value;
      if (timeEntries.length === 0) {
        warnings.push({
          type: 'NO_TIME_ENTRIES',
          message: '該当期間の打刻データはありません',
        });
      }
    } else {
      errors.push({ source: 'toggl', message: timeEntriesResult.error });
      warnings.push({
        type: 'PARTIAL_DATA',
        source: 'toggl',
        message: `Togglデータの取得に失敗しました: ${timeEntriesResult.error}`,
      });
    }

    // If all sources failed, return error
    if (!prsResult.success && !timeEntriesResult.success) {
      return err({
        type: 'ALL_SOURCES_FAILED',
        errors,
      });
    }

    // Generate summaries
    const dailySummaries = this.generateDailySummaries(dateRange, pullRequests, timeEntries);
    const projectSummaries = this.generateProjectSummaries(pullRequests, timeEntries);

    return ok({
      dateRange,
      pullRequests,
      timeEntries,
      dailySummaries,
      projectSummaries,
      warnings,
    });
  }

  /**
   * Collect pull requests from multiple repositories in parallel
   */
  private async collectGitHubPullRequests(
    dateRange: DateRange,
    repositories: readonly string[]
  ): Promise<Result<PullRequestData[], string>> {
    const results = await Promise.all(
      repositories.map((repo) => this.githubClient.getPullRequests(repo, dateRange))
    );

    const allPRs: PullRequestData[] = [];
    const errors: string[] = [];

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const repo = repositories[i];
      if (result.success) {
        const mapped = result.value.map((pr) => this.mapPullRequestData(pr, repo));
        allPRs.push(...mapped);
      } else {
        errors.push(`${repo}: ${result.error.message || result.error.type}`);
      }
    }

    // If all repos failed, return error
    if (errors.length === repositories.length && repositories.length > 0) {
      return err(errors.join('; '));
    }

    return ok(allPRs);
  }

  /**
   * Collect time entries from Toggl
   */
  private async collectTogglTimeEntries(
    dateRange: DateRange,
    workspaceId?: number
  ): Promise<Result<TimeEntryData[], string>> {
    const result = await this.togglClient.getTimeEntriesWithProjectNames(dateRange, workspaceId);

    if (!result.success) {
      return err(result.error.message || result.error.type);
    }

    const timeEntries = result.value.map((entry) => this.mapTimeEntryData(entry));
    return ok(timeEntries);
  }

  /**
   * Map GitHub pull request to domain PullRequestData
   */
  private mapPullRequestData(pr: GitHubPullRequest, repository: string): PullRequestData {
    let state: 'open' | 'closed' | 'merged';
    if (pr.merged) {
      state = 'merged';
    } else {
      state = pr.state;
    }

    return {
      number: pr.number,
      title: pr.title,
      description: pr.body || '',
      createdAt: new Date(pr.createdAt),
      repository,
      url: pr.htmlUrl,
      state,
    };
  }

  /**
   * Map Toggl time entry to domain TimeEntryData
   */
  private mapTimeEntryData(
    entry: TogglTimeEntry & { readonly projectName: string }
  ): TimeEntryData {
    return {
      id: entry.id,
      description: entry.description,
      projectName: entry.projectName,
      startTime: new Date(entry.start),
      endTime: entry.stop ? new Date(entry.stop) : new Date(),
      durationSeconds: entry.duration,
      tags: [...entry.tags],
    };
  }

  /**
   * Generate daily summaries from integrated data
   */
  private generateDailySummaries(
    dateRange: DateRange,
    pullRequests: readonly PullRequestData[],
    timeEntries: readonly TimeEntryData[]
  ): DailySummary[] {
    const summaryMap = new Map<string, { prCount: number; workSeconds: number; projects: Set<string> }>();

    // Initialize days in range
    const current = new Date(dateRange.start);
    while (current <= dateRange.end) {
      const dateKey = this.getDateKey(current);
      summaryMap.set(dateKey, { prCount: 0, workSeconds: 0, projects: new Set() });
      current.setDate(current.getDate() + 1);
    }

    // Aggregate pull requests by day
    for (const pr of pullRequests) {
      const dateKey = this.getDateKey(pr.createdAt);
      const summary = summaryMap.get(dateKey);
      if (summary) {
        summary.prCount++;
        summary.projects.add(pr.repository);
      }
    }

    // Aggregate time entries by day
    for (const entry of timeEntries) {
      const dateKey = this.getDateKey(entry.startTime);
      const summary = summaryMap.get(dateKey);
      if (summary) {
        summary.workSeconds += entry.durationSeconds;
        summary.projects.add(entry.projectName);
      }
    }

    // Convert to DailySummary array, filter out empty days
    const summaries: DailySummary[] = [];
    for (const [dateKey, data] of summaryMap) {
      if (data.prCount > 0 || data.workSeconds > 0) {
        summaries.push({
          date: new Date(dateKey + 'T00:00:00Z'),
          prCount: data.prCount,
          workHours: data.workSeconds / 3600,
          projects: Array.from(data.projects),
        });
      }
    }

    return summaries.sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  /**
   * Generate project summaries from integrated data
   */
  private generateProjectSummaries(
    pullRequests: readonly PullRequestData[],
    timeEntries: readonly TimeEntryData[]
  ): ProjectSummary[] {
    const projectMap = new Map<string, { totalPRs: number; totalWorkSeconds: number }>();

    // Aggregate pull requests by repository
    for (const pr of pullRequests) {
      const existing = projectMap.get(pr.repository) || { totalPRs: 0, totalWorkSeconds: 0 };
      existing.totalPRs++;
      projectMap.set(pr.repository, existing);
    }

    // Aggregate time entries by project
    for (const entry of timeEntries) {
      const existing = projectMap.get(entry.projectName) || { totalPRs: 0, totalWorkSeconds: 0 };
      existing.totalWorkSeconds += entry.durationSeconds;
      projectMap.set(entry.projectName, existing);
    }

    return Array.from(projectMap.entries()).map(([name, data]) => ({
      projectName: name,
      totalPRs: data.totalPRs,
      totalWorkHours: data.totalWorkSeconds / 3600,
    }));
  }

  /**
   * Get date key in YYYY-MM-DD format (UTC)
   */
  private getDateKey(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
