import { Result, ok, err } from '../types/result.js';
import type { AnalysisResult } from './activity-analyzer.js';
import type { IntegratedData } from './data-integrator.js';
import type {
  NotionPageContent,
  NotionBlock,
  NotionPage,
  NotionError,
} from '../infrastructure/clients/notion-client.js';

/**
 * Page build options
 */
export interface PageBuildOptions {
  readonly dryRun: boolean;
  readonly databaseId: string;
  readonly previousPageId?: string;
  readonly previousTryItems?: readonly string[];
}

/**
 * Page build result
 */
export interface PageResult {
  readonly pageUrl?: string;
  readonly pageId?: string;
  readonly title: string;
}

/**
 * Page build error
 */
export type PageBuildError = {
  readonly type: 'NOTION_API_ERROR';
  readonly message: string;
  readonly fallbackPath?: string;
};

/**
 * Notion client interface for dependency injection
 */
export interface INotionClient {
  createPage(
    content: NotionPageContent,
    databaseId: string
  ): Promise<Result<NotionPage, NotionError>>;
}

/**
 * ReflectionPageBuilder - 振り返りページコンテンツの構築
 *
 * Responsibilities:
 * - Notionページ構造の構築（タイトル、プロパティ、ブロック）
 * - KPTフレームワークセクションの生成
 * - 前週振り返りへの参照追加
 * - Markdownフォーマットへのフォールバック変換
 */
export class ReflectionPageBuilder {
  constructor(private readonly notionClient: INotionClient) {}

  /**
   * Build page content and create in Notion
   */
  async buildAndCreate(
    analysis: AnalysisResult,
    data: IntegratedData,
    options: PageBuildOptions
  ): Promise<Result<PageResult, PageBuildError>> {
    const title = this.generateTitle(data);
    const content = this.buildNotionContent(title, analysis, data, options);

    // In dry run mode, return without creating page
    if (options.dryRun) {
      return ok({
        pageUrl: undefined,
        pageId: undefined,
        title,
      });
    }

    // Create page in Notion
    const result = await this.notionClient.createPage(content, options.databaseId);

    if (!result.success) {
      return err({
        type: 'NOTION_API_ERROR',
        message: `Notionページの作成に失敗しました: ${result.error.type} - ${'message' in result.error ? result.error.message : ''}`,
      });
    }

    return ok({
      pageUrl: result.value.url,
      pageId: result.value.id,
      title,
    });
  }

  /**
   * Build Markdown representation of the reflection page
   */
  buildMarkdown(analysis: AnalysisResult, data: IntegratedData): string {
    const title = this.generateTitle(data);
    const lines: string[] = [];

    lines.push(`# ${title}`);
    lines.push('');

    // Week summary
    lines.push('## 週次サマリー');
    lines.push('');
    lines.push(analysis.weekSummary);
    lines.push('');

    // Insights
    if (analysis.insights.length > 0) {
      lines.push('## インサイト');
      lines.push('');
      for (const insight of analysis.insights) {
        lines.push(`- ${insight}`);
      }
      lines.push('');
    }

    // GitHub commit summary
    lines.push('## GitHubコミットサマリー');
    lines.push('');
    if (data.commits.length > 0) {
      // Group by repository
      const repoMap = new Map<string, typeof data.commits>();
      for (const commit of data.commits) {
        const existing = repoMap.get(commit.repository) || [];
        repoMap.set(commit.repository, [...existing, commit]);
      }

      for (const [repo, commits] of repoMap) {
        lines.push(`### ${repo}`);
        lines.push('');
        for (const commit of commits) {
          const date = commit.authorDate.toISOString().split('T')[0];
          lines.push(`- ${commit.message} (${date}) [+${commit.additions}/-${commit.deletions}]`);
        }
        lines.push('');
      }
    } else {
      lines.push('該当期間のコミットはありません。');
      lines.push('');
    }

    // Toggl time summary
    lines.push('## Toggl作業時間サマリー');
    lines.push('');
    if (data.timeEntries.length > 0) {
      const projectMap = new Map<string, typeof data.timeEntries>();
      for (const entry of data.timeEntries) {
        const existing = projectMap.get(entry.projectName) || [];
        projectMap.set(entry.projectName, [...existing, entry]);
      }

      for (const [project, entries] of projectMap) {
        const totalHours = entries.reduce((sum, e) => sum + e.durationSeconds / 3600, 0);
        lines.push(`### ${project} (${totalHours.toFixed(1)}h)`);
        lines.push('');
        for (const entry of entries) {
          const hours = (entry.durationSeconds / 3600).toFixed(1);
          lines.push(`- ${entry.description}: ${hours}h`);
        }
        lines.push('');
      }
    } else {
      lines.push('該当期間の作業時間記録はありません。');
      lines.push('');
    }

    // KPT sections
    lines.push('---');
    lines.push('');
    lines.push('## Keep（継続すること）');
    lines.push('');
    if (analysis.kptSuggestions.keep.length > 0) {
      for (const item of analysis.kptSuggestions.keep) {
        lines.push(`- ${item}`);
      }
    }
    lines.push('');

    lines.push('## Problem（問題点）');
    lines.push('');
    if (analysis.kptSuggestions.problem.length > 0) {
      for (const item of analysis.kptSuggestions.problem) {
        lines.push(`- ${item}`);
      }
    }
    lines.push('');

    lines.push('## Try（次週挑戦すること）');
    lines.push('');
    if (analysis.kptSuggestions.tryItems.length > 0) {
      for (const item of analysis.kptSuggestions.tryItems) {
        lines.push(`- ${item}`);
      }
    }
    lines.push('');

    // Daily analysis
    if (analysis.dailySummaries.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## 日別活動詳細');
      lines.push('');
      for (const daily of analysis.dailySummaries) {
        const dateStr = daily.date.toISOString().split('T')[0];
        lines.push(`### ${dateStr}`);
        lines.push('');
        lines.push(daily.summary);
        lines.push('');
        for (const highlight of daily.highlights) {
          lines.push(`- ${highlight}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  /**
   * Generate page title with week number and date range
   */
  private generateTitle(data: IntegratedData): string {
    const startStr = data.dateRange.start.toISOString().split('T')[0];
    const endStr = data.dateRange.end.toISOString().split('T')[0];
    const weekNumber = this.getWeekNumber(data.dateRange.start);

    return `Week ${weekNumber}: ${startStr} - ${endStr}`;
  }

  /**
   * Build Notion page content structure
   */
  private buildNotionContent(
    title: string,
    analysis: AnalysisResult,
    data: IntegratedData,
    options: PageBuildOptions
  ): NotionPageContent {
    const blocks: NotionBlock[] = [];

    // Week summary section
    blocks.push({ type: 'heading_1', content: '週次サマリー' });
    blocks.push({ type: 'paragraph', content: analysis.weekSummary });
    blocks.push({ type: 'divider' });

    // Insights section
    if (analysis.insights.length > 0) {
      blocks.push({ type: 'heading_2', content: 'インサイト' });
      for (const insight of analysis.insights) {
        blocks.push({ type: 'bulleted_list_item', content: insight });
      }
      blocks.push({ type: 'divider' });
    }

    // GitHub commit summary section
    blocks.push({ type: 'heading_1', content: 'GitHubコミットサマリー' });
    if (data.commits.length > 0) {
      const repoMap = new Map<string, typeof data.commits>();
      for (const commit of data.commits) {
        const existing = repoMap.get(commit.repository) || [];
        repoMap.set(commit.repository, [...existing, commit]);
      }

      for (const [repo, commits] of repoMap) {
        blocks.push({ type: 'heading_3', content: repo });
        for (const commit of commits) {
          const date = commit.authorDate.toISOString().split('T')[0];
          blocks.push({
            type: 'bulleted_list_item',
            content: `${commit.message} (${date}) [+${commit.additions}/-${commit.deletions}]`,
          });
        }
      }
    } else {
      blocks.push({ type: 'paragraph', content: '該当期間のコミットはありません。' });
    }
    blocks.push({ type: 'divider' });

    // Toggl time summary section
    blocks.push({ type: 'heading_1', content: 'Toggl作業時間サマリー' });
    if (data.timeEntries.length > 0) {
      const projectMap = new Map<string, typeof data.timeEntries>();
      for (const entry of data.timeEntries) {
        const existing = projectMap.get(entry.projectName) || [];
        projectMap.set(entry.projectName, [...existing, entry]);
      }

      for (const [project, entries] of projectMap) {
        const totalHours = entries.reduce((sum, e) => sum + e.durationSeconds / 3600, 0);
        blocks.push({ type: 'heading_3', content: `${project} (${totalHours.toFixed(1)}h)` });
        for (const entry of entries) {
          const hours = (entry.durationSeconds / 3600).toFixed(1);
          blocks.push({
            type: 'bulleted_list_item',
            content: `${entry.description}: ${hours}h`,
          });
        }
      }
    } else {
      blocks.push({ type: 'paragraph', content: '該当期間の作業時間記録はありません。' });
    }
    blocks.push({ type: 'divider' });

    // Previous Try items reference section
    if (options.previousTryItems && options.previousTryItems.length > 0) {
      blocks.push({ type: 'heading_2', content: '前週のTry項目（参照）' });
      for (const item of options.previousTryItems) {
        blocks.push({ type: 'bulleted_list_item', content: item });
      }
      blocks.push({ type: 'divider' });
    }

    // KPT sections
    blocks.push({ type: 'heading_1', content: 'Keep（継続すること）' });
    blocks.push({
      type: 'paragraph',
      content: 'ここに継続すべきことを記入してください。以下はAI提案です。',
    });
    for (const item of analysis.kptSuggestions.keep) {
      blocks.push({ type: 'bulleted_list_item', content: item });
    }
    blocks.push({ type: 'divider' });

    blocks.push({ type: 'heading_1', content: 'Problem（問題点）' });
    blocks.push({
      type: 'paragraph',
      content: 'ここに問題点を記入してください。以下はAI提案です。',
    });
    for (const item of analysis.kptSuggestions.problem) {
      blocks.push({ type: 'bulleted_list_item', content: item });
    }
    blocks.push({ type: 'divider' });

    blocks.push({ type: 'heading_1', content: 'Try（次週挑戦すること）' });
    blocks.push({
      type: 'paragraph',
      content: 'ここに次週挑戦することを記入してください。以下はAI提案です。',
    });
    for (const item of analysis.kptSuggestions.tryItems) {
      blocks.push({ type: 'bulleted_list_item', content: item });
    }

    // Daily details section
    if (analysis.dailySummaries.length > 0) {
      blocks.push({ type: 'divider' });
      blocks.push({ type: 'heading_1', content: '日別活動詳細' });
      for (const daily of analysis.dailySummaries) {
        const dateStr = daily.date.toISOString().split('T')[0];
        blocks.push({ type: 'heading_3', content: dateStr });
        blocks.push({ type: 'paragraph', content: daily.summary });
        for (const highlight of daily.highlights) {
          blocks.push({ type: 'bulleted_list_item', content: highlight });
        }
      }
    }

    // Build properties
    const startStr = data.dateRange.start.toISOString().split('T')[0];
    const endStr = data.dateRange.end.toISOString().split('T')[0];
    const weekNumber = this.getWeekNumber(data.dateRange.start);
    const totalWorkHours = data.timeEntries.reduce(
      (sum, e) => sum + e.durationSeconds / 3600,
      0
    );

    return {
      title,
      properties: {
        weekNumber,
        dateRange: `${startStr} - ${endStr}`,
        tags: ['weekly-reflection', 'auto-generated'],
        commitCount: data.commits.length,
        workHours: Math.round(totalWorkHours * 10) / 10,
        aiEnabled: analysis.aiEnabled,
      },
      blocks,
    };
  }

  /**
   * Get ISO week number for a date
   */
  private getWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }
}
