import { Result, ok } from '../types/result.js';
import type { IntegratedData } from './data-integrator.js';
import type { SummaryInput, KPTInput, KPTSuggestions, OpenAIError } from '../infrastructure/clients/openai-client.js';

/**
 * Daily analysis result
 */
export interface DailyAnalysis {
  readonly date: Date;
  readonly summary: string;
  readonly highlights: readonly string[];
}

/**
 * Weekly comparison
 */
export interface WeeklyComparison {
  readonly commitDelta: number;
  readonly workHoursDelta: number;
  readonly trend: 'increasing' | 'decreasing' | 'stable';
}

/**
 * Project distribution
 */
export interface ProjectDistribution {
  readonly projectName: string;
  readonly percentage: number;
}

/**
 * Activity trend
 */
export interface ActivityTrend {
  readonly weeklyComparison?: WeeklyComparison;
  readonly projectDistribution: readonly ProjectDistribution[];
}

/**
 * Analysis result
 */
export interface AnalysisResult {
  readonly dailySummaries: readonly DailyAnalysis[];
  readonly weekSummary: string;
  readonly insights: readonly string[];
  readonly kptSuggestions: KPTSuggestions;
  readonly activityTrend?: ActivityTrend;
  readonly aiEnabled: boolean;
}

/**
 * Analysis error
 */
export type AnalysisError = {
  readonly type: 'AI_UNAVAILABLE';
  readonly fallbackUsed: true;
};

/**
 * OpenAI client interface for dependency injection
 */
export interface IOpenAIClient {
  generateSummary(data: SummaryInput): Promise<Result<string, OpenAIError>>;
  generateKPTSuggestions(data: KPTInput): Promise<Result<KPTSuggestions, OpenAIError>>;
}

/**
 * ActivityAnalyzer - 統合データのAI分析とKPT提案生成
 *
 * Responsibilities:
 * - OpenAI APIを使用した活動サマリー生成
 * - コミット数と作業時間の相関分析
 * - KPT（Keep/Problem/Try）提案の自動生成
 * - OpenAI API障害時の基本サマリーフォールバック
 */
export class ActivityAnalyzer {
  constructor(private readonly openaiClient: IOpenAIClient) {}

  /**
   * Analyze integrated data and generate insights
   */
  async analyze(
    data: IntegratedData,
    previousTryItems?: readonly string[]
  ): Promise<Result<AnalysisResult, AnalysisError>> {
    // Generate daily analyses from raw data
    const dailySummaries = this.generateDailyAnalyses(data);

    // Generate insights from data
    const insights = this.generateInsights(data);

    // Generate highlights for KPT input
    const highlights = this.extractHighlights(data);

    // Prepare summary input for OpenAI
    const summaryInput = this.buildSummaryInput(data);

    // Try AI-powered summary generation
    let weekSummary: string;
    let aiEnabled = false;

    const summaryResult = await this.openaiClient.generateSummary(summaryInput);
    if (summaryResult.success) {
      weekSummary = summaryResult.value;
      aiEnabled = true;
    } else {
      // Fallback to basic summary
      weekSummary = this.generateBasicSummary(data);
    }

    // Try AI-powered KPT suggestions
    let kptSuggestions: KPTSuggestions;

    const kptInput: KPTInput = {
      weekSummary,
      highlights,
      previousTryItems,
    };

    const kptResult = await this.openaiClient.generateKPTSuggestions(kptInput);
    if (kptResult.success) {
      kptSuggestions = kptResult.value;
    } else {
      // Fallback to basic KPT
      kptSuggestions = this.generateBasicKPT(data);
    }

    // Generate activity trend
    const activityTrend = this.generateActivityTrend(data);

    return ok({
      dailySummaries,
      weekSummary,
      insights,
      kptSuggestions,
      activityTrend,
      aiEnabled,
    });
  }

  /**
   * Generate daily analysis entries from integrated data
   */
  private generateDailyAnalyses(data: IntegratedData): DailyAnalysis[] {
    return data.dailySummaries.map((ds) => {
      const dayCommits = data.commits.filter(
        (c) => this.getDateKey(c.authorDate) === this.getDateKey(ds.date)
      );
      const dayEntries = data.timeEntries.filter(
        (e) => this.getDateKey(e.startTime) === this.getDateKey(ds.date)
      );

      const highlights: string[] = [];

      // Add commit highlights
      for (const commit of dayCommits) {
        highlights.push(`${commit.repository}: ${commit.message}`);
      }

      // Add time entry highlights (consolidate same description)
      const entryMap = new Map<string, number>();
      for (const entry of dayEntries) {
        const key = `${entry.projectName}: ${entry.description}`;
        entryMap.set(key, (entryMap.get(key) || 0) + entry.durationSeconds / 3600);
      }
      for (const [desc, hours] of [...entryMap.entries()].sort((a, b) => b[1] - a[1])) {
        highlights.push(`${desc} (${hours.toFixed(1)}h)`);
      }

      const summary = this.buildDaySummary(ds.commitCount, ds.workHours, ds.projects);

      return {
        date: ds.date,
        summary,
        highlights,
      };
    });
  }

  /**
   * Generate insights from data analysis
   */
  private generateInsights(data: IntegratedData): string[] {
    const insights: string[] = [];

    const totalCommits = data.commits.length;
    const totalWorkHours = data.timeEntries.reduce((sum, e) => sum + e.durationSeconds / 3600, 0);

    if (totalCommits > 0) {
      insights.push(`今週の総コミット数: ${totalCommits}件`);
    }

    if (totalWorkHours > 0) {
      insights.push(`今週の総作業時間: ${totalWorkHours.toFixed(1)}時間`);
    }

    if (totalCommits > 0 && totalWorkHours > 0) {
      const commitsPerHour = totalCommits / totalWorkHours;
      insights.push(`作業時間あたりのコミット数: ${commitsPerHour.toFixed(2)}件/時間`);
    }

    // Most active day
    if (data.dailySummaries.length > 0) {
      const mostActiveDay = [...data.dailySummaries].sort(
        (a, b) => (b.commitCount + b.workHours) - (a.commitCount + a.workHours)
      )[0];
      const dayName = this.getDayName(mostActiveDay.date);
      insights.push(`最も活動的な日: ${dayName}（コミット${mostActiveDay.commitCount}件、${mostActiveDay.workHours.toFixed(1)}h）`);
    }

    // Project diversity
    const uniqueProjects = new Set<string>();
    for (const ps of data.projectSummaries) {
      uniqueProjects.add(ps.projectName);
    }
    if (uniqueProjects.size > 1) {
      insights.push(`関わったプロジェクト数: ${uniqueProjects.size}`);
    }

    return insights;
  }

  /**
   * Extract highlights for KPT input
   */
  private extractHighlights(data: IntegratedData): string[] {
    const highlights: string[] = [];

    // Top commits by size
    const sortedCommits = [...data.commits].sort((a, b) => b.filesChanged - a.filesChanged);
    for (const commit of sortedCommits.slice(0, 3)) {
      highlights.push(`${commit.repository}: ${commit.message} (+${commit.additions}/-${commit.deletions})`);
    }

    // Largest time entries
    const sortedEntries = [...data.timeEntries].sort((a, b) => b.durationSeconds - a.durationSeconds);
    for (const entry of sortedEntries.slice(0, 3)) {
      const hours = (entry.durationSeconds / 3600).toFixed(1);
      highlights.push(`${entry.projectName}: ${entry.description} (${hours}h)`);
    }

    return highlights;
  }

  /**
   * Build summary input for OpenAI
   */
  private buildSummaryInput(data: IntegratedData): SummaryInput {
    return {
      commits: data.commits.map((c) => ({
        message: c.message,
        repository: c.repository,
        date: c.authorDate.toISOString().split('T')[0],
      })),
      timeEntries: data.timeEntries.map((e) => ({
        description: e.description,
        projectName: e.projectName,
        durationHours: e.durationSeconds / 3600,
      })),
      period: {
        start: data.dateRange.start.toISOString().split('T')[0],
        end: data.dateRange.end.toISOString().split('T')[0],
      },
    };
  }

  /**
   * Generate basic summary without AI (fallback)
   */
  private generateBasicSummary(data: IntegratedData): string {
    const totalCommits = data.commits.length;
    const totalWorkHours = data.timeEntries.reduce((sum, e) => sum + e.durationSeconds / 3600, 0);
    const period = `${data.dateRange.start.toISOString().split('T')[0]} - ${data.dateRange.end.toISOString().split('T')[0]}`;

    const parts: string[] = [];
    parts.push(`期間: ${period}`);

    if (totalCommits > 0) {
      const repos = new Set(data.commits.map((c) => c.repository));
      parts.push(`コミット: ${totalCommits}件（${repos.size}リポジトリ）`);
    } else {
      parts.push('コミット: なし');
    }

    if (totalWorkHours > 0) {
      const projects = new Set(data.timeEntries.map((e) => e.projectName));
      parts.push(`作業時間: ${totalWorkHours.toFixed(1)}時間（${projects.size}プロジェクト）`);
    } else {
      parts.push('作業時間: 記録なし');
    }

    parts.push(`活動日数: ${data.dailySummaries.length}日`);

    return parts.join('\n');
  }

  /**
   * Generate basic KPT suggestions without AI (fallback)
   */
  private generateBasicKPT(data: IntegratedData): KPTSuggestions {
    const keep: string[] = [];
    const problem: string[] = [];
    const tryItems: string[] = [];

    const totalCommits = data.commits.length;
    const totalWorkHours = data.timeEntries.reduce((sum, e) => sum + e.durationSeconds / 3600, 0);

    if (totalCommits > 0) {
      keep.push('コミットによる活動記録を継続できています');
    }

    if (totalWorkHours > 0) {
      keep.push('Togglでの作業時間記録を継続できています');
    }

    if (totalCommits === 0 && totalWorkHours === 0) {
      problem.push('今週は活動データが記録されていません');
      tryItems.push('日々の活動をGitHubコミットとTogglで記録しましょう');
    }

    if (data.dailySummaries.length < 3) {
      problem.push('活動日数が少ない可能性があります');
      tryItems.push('より多くの日に分散して作業しましょう');
    }

    // Ensure at least one item in each category
    if (keep.length === 0) {
      keep.push('振り返りを実施していることは良い習慣です');
    }
    if (problem.length === 0) {
      problem.push('特に大きな問題は見当たりません');
    }
    if (tryItems.length === 0) {
      tryItems.push('来週も引き続き活動を記録しましょう');
    }

    return { keep, problem, tryItems };
  }

  /**
   * Generate activity trend analysis
   */
  private generateActivityTrend(data: IntegratedData): ActivityTrend | undefined {
    if (data.projectSummaries.length === 0) {
      return undefined;
    }

    // Calculate total work hours for distribution
    const totalWorkHours = data.projectSummaries.reduce(
      (sum, p) => sum + p.totalWorkHours,
      0
    );
    const totalCommits = data.projectSummaries.reduce(
      (sum, p) => sum + p.totalCommits,
      0
    );
    const totalActivity = totalWorkHours + totalCommits;

    if (totalActivity === 0) {
      return undefined;
    }

    const projectDistribution: ProjectDistribution[] = data.projectSummaries
      .filter((p) => p.totalWorkHours > 0 || p.totalCommits > 0)
      .map((p) => ({
        projectName: p.projectName,
        percentage: ((p.totalWorkHours + p.totalCommits) / totalActivity) * 100,
      }))
      .sort((a, b) => b.percentage - a.percentage);

    return {
      projectDistribution,
    };
  }

  /**
   * Build a summary for a single day
   */
  private buildDaySummary(commitCount: number, workHours: number, projects: readonly string[]): string {
    const parts: string[] = [];

    if (commitCount > 0) {
      parts.push(`${commitCount}件のコミット`);
    }

    if (workHours > 0) {
      parts.push(`${workHours.toFixed(1)}時間の作業`);
    }

    if (projects.length > 0) {
      parts.push(`プロジェクト: ${projects.join(', ')}`);
    }

    return parts.join(' / ');
  }

  /**
   * Get Japanese day name
   */
  private getDayName(date: Date): string {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    const dateStr = date.toISOString().split('T')[0];
    const dayOfWeek = new Date(dateStr + 'T00:00:00Z').getUTCDay();
    return `${dateStr}(${days[dayOfWeek]})`;
  }

  /**
   * Get date key in YYYY-MM-DD format
   */
  private getDateKey(date: Date): string {
    return date.toISOString().split('T')[0];
  }
}
