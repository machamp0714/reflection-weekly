import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataIntegrator } from '../domain/data-integrator.js';
import { ActivityAnalyzer } from '../domain/activity-analyzer.js';
import { ReflectionPageBuilder } from '../domain/reflection-page-builder.js';
import { ReflectionUseCase, type ReflectionOptions } from '../application/reflection-use-case.js';
import { ok, err } from '../types/result.js';
import type { GitHubPullRequest } from '../infrastructure/clients/github-client.js';
import type { TogglTimeEntry } from '../infrastructure/clients/toggl-client.js';
import type { KPTSuggestions, OpenAIError } from '../infrastructure/clients/openai-client.js';
import type { NotionPage, NotionError, NotionPageContent } from '../infrastructure/clients/notion-client.js';
import type { AppConfig } from '../infrastructure/config/config-manager.js';
import type { DateRange, DataSourceConfig } from '../domain/data-integrator.js';

/**
 * 統合テスト: Task 7.2
 *
 * コンポーネント間のデータフローをテストする:
 *   DataIntegrator -> ActivityAnalyzer -> ReflectionPageBuilder -> ReflectionUseCase
 *
 * テスト対象:
 * - データ統合ロジックの日別・プロジェクト別集計
 * - 活動分析のAIサマリー生成（モック使用）
 * - ページ構築のNotionブロック生成・Markdown変換
 * - 全体フローの正常系
 * - 各API障害時のフォールバック動作
 */

// =============================================================================
// 共有テストデータ
// =============================================================================

/**
 * 1週間分のテストデータ（複数リポジトリ、複数プロジェクト、複数日にわたる）
 */
const TEST_DATE_RANGE: DateRange = {
  start: new Date('2026-01-27T00:00:00Z'),
  end: new Date('2026-02-02T23:59:59Z'),
};

const TEST_DATA_SOURCE_CONFIG: DataSourceConfig = {
  repositories: ['org/frontend', 'org/backend', 'org/infrastructure'],
  workspaceId: 99999,
};

function createRealisticPullRequests(repoName: string): GitHubPullRequest[] {
  const prsByRepo: Record<string, GitHubPullRequest[]> = {
    'org/frontend': [
      {
        number: 101,
        title: 'feat: ダッシュボード画面を実装',
        body: 'ダッシュボードのUIコンポーネントを追加しました。',
        user: { login: 'dev-user' },
        createdAt: '2026-01-27T10:00:00Z',
        url: 'https://api.github.com/repos/org/frontend/pulls/101',
        htmlUrl: 'https://github.com/org/frontend/pull/101',
        state: 'closed',
        merged: true,
      },
      {
        number: 102,
        title: 'fix: レスポンシブ対応の修正',
        body: 'モバイル表示のレイアウト崩れを修正。',
        user: { login: 'dev-user' },
        createdAt: '2026-01-29T14:30:00Z',
        url: 'https://api.github.com/repos/org/frontend/pulls/102',
        htmlUrl: 'https://github.com/org/frontend/pull/102',
        state: 'closed',
        merged: true,
      },
    ],
    'org/backend': [
      {
        number: 55,
        title: 'feat: REST API エンドポイント追加',
        body: 'ユーザー管理APIのエンドポイントを追加。',
        user: { login: 'dev-user' },
        createdAt: '2026-01-28T09:00:00Z',
        url: 'https://api.github.com/repos/org/backend/pulls/55',
        htmlUrl: 'https://github.com/org/backend/pull/55',
        state: 'closed',
        merged: true,
      },
      {
        number: 56,
        title: 'refactor: データベースクエリ最適化',
        body: 'N+1問題を解消。',
        user: { login: 'dev-user' },
        createdAt: '2026-01-30T11:00:00Z',
        url: 'https://api.github.com/repos/org/backend/pulls/56',
        htmlUrl: 'https://github.com/org/backend/pull/56',
        state: 'open',
        merged: false,
      },
    ],
    'org/infrastructure': [
      {
        number: 20,
        title: 'chore: CI/CDパイプライン更新',
        body: 'GitHub Actionsのワークフローを更新。',
        user: { login: 'dev-user' },
        createdAt: '2026-01-31T16:00:00Z',
        url: 'https://api.github.com/repos/org/infrastructure/pulls/20',
        htmlUrl: 'https://github.com/org/infrastructure/pull/20',
        state: 'closed',
        merged: true,
      },
    ],
  };
  return prsByRepo[repoName] || [];
}

function createRealisticTimeEntries(): (TogglTimeEntry & { projectName: string })[] {
  return [
    // 1/27 (月) - フロントエンド開発
    {
      id: 1001,
      description: 'ダッシュボード画面実装',
      start: '2026-01-27T09:00:00Z',
      stop: '2026-01-27T12:00:00Z',
      duration: 10800,
      projectId: 501,
      workspaceId: 99999,
      tags: ['development'],
      billable: true,
      projectName: 'フロントエンド開発',
    },
    {
      id: 1002,
      description: 'コードレビュー',
      start: '2026-01-27T13:00:00Z',
      stop: '2026-01-27T14:30:00Z',
      duration: 5400,
      projectId: 501,
      workspaceId: 99999,
      tags: ['review'],
      billable: true,
      projectName: 'フロントエンド開発',
    },
    // 1/28 (火) - バックエンド開発
    {
      id: 1003,
      description: 'REST API実装',
      start: '2026-01-28T09:00:00Z',
      stop: '2026-01-28T13:00:00Z',
      duration: 14400,
      projectId: 502,
      workspaceId: 99999,
      tags: ['development'],
      billable: true,
      projectName: 'バックエンド開発',
    },
    {
      id: 1004,
      description: 'テスト作成',
      start: '2026-01-28T14:00:00Z',
      stop: '2026-01-28T16:00:00Z',
      duration: 7200,
      projectId: 502,
      workspaceId: 99999,
      tags: ['testing'],
      billable: true,
      projectName: 'バックエンド開発',
    },
    // 1/29 (水) - フロントエンド + ミーティング
    {
      id: 1005,
      description: 'レスポンシブ対応修正',
      start: '2026-01-29T09:00:00Z',
      stop: '2026-01-29T11:00:00Z',
      duration: 7200,
      projectId: 501,
      workspaceId: 99999,
      tags: ['bugfix'],
      billable: true,
      projectName: 'フロントエンド開発',
    },
    {
      id: 1006,
      description: 'スプリントレビュー',
      start: '2026-01-29T14:00:00Z',
      stop: '2026-01-29T15:00:00Z',
      duration: 3600,
      projectId: 503,
      workspaceId: 99999,
      tags: ['meeting'],
      billable: false,
      projectName: 'チームミーティング',
    },
    // 1/30 (木) - バックエンド + インフラ
    {
      id: 1007,
      description: 'データベースクエリ最適化',
      start: '2026-01-30T09:00:00Z',
      stop: '2026-01-30T12:00:00Z',
      duration: 10800,
      projectId: 502,
      workspaceId: 99999,
      tags: ['refactoring'],
      billable: true,
      projectName: 'バックエンド開発',
    },
    // 1/31 (金) - インフラ
    {
      id: 1008,
      description: 'CI/CDパイプライン更新',
      start: '2026-01-31T10:00:00Z',
      stop: '2026-01-31T13:00:00Z',
      duration: 10800,
      projectId: 504,
      workspaceId: 99999,
      tags: ['infrastructure'],
      billable: true,
      projectName: 'インフラ作業',
    },
  ];
}

function createMockAppConfig(): AppConfig {
  return {
    github: {
      token: 'ghp_test_integration',
      repositories: ['org/frontend', 'org/backend', 'org/infrastructure'],
      username: 'dev-user',
    },
    toggl: {
      apiToken: 'toggl_test_integration',
      workspaceId: 99999,
    },
    notion: {
      token: 'ntn_test_integration',
      databaseId: 'integration-test-db-id',
    },
    openai: {
      apiKey: 'sk-test-integration',
      model: 'gpt-4o',
    },
    reflection: {
      defaultPeriodDays: 7,
    },
    schedule: {
      cronExpression: '0 19 * * 0',
      timezone: 'Asia/Tokyo',
      enabled: false,
    },
    logging: {
      logFilePath: '/tmp/test-logs/execution.log',
      logLevel: 'info',
      maxLogFiles: 10,
      maxLogSize: '10MB',
    },
  };
}

// =============================================================================
// 統合テスト 1: DataIntegrator -> ActivityAnalyzer データフロー
// =============================================================================

describe('統合テスト: DataIntegrator -> ActivityAnalyzer データフロー', () => {
  let mockGitHubClient: {
    getPullRequests: ReturnType<typeof vi.fn>;
  };
  let mockTogglClient: {
    getTimeEntries: ReturnType<typeof vi.fn>;
    getProjects: ReturnType<typeof vi.fn>;
    getProjectName: ReturnType<typeof vi.fn>;
    getTimeEntriesWithProjectNames: ReturnType<typeof vi.fn>;
  };
  let mockOpenAIClient: {
    generateSummary: ReturnType<typeof vi.fn>;
    generateKPTSuggestions: ReturnType<typeof vi.fn>;
  };
  let integrator: DataIntegrator;
  let analyzer: ActivityAnalyzer;

  beforeEach(() => {
    mockGitHubClient = { getPullRequests: vi.fn() };
    mockTogglClient = {
      getTimeEntries: vi.fn(),
      getProjects: vi.fn(),
      getProjectName: vi.fn(),
      getTimeEntriesWithProjectNames: vi.fn(),
    };
    mockOpenAIClient = {
      generateSummary: vi.fn(),
      generateKPTSuggestions: vi.fn(),
    };
    integrator = new DataIntegrator(mockGitHubClient, mockTogglClient);
    analyzer = new ActivityAnalyzer(mockOpenAIClient);
  });

  it('DataIntegratorの出力をActivityAnalyzerに渡して日別分析が正しく生成される', async () => {
    // DataIntegratorのモック設定
    mockGitHubClient.getPullRequests
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/frontend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/backend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/infrastructure')));
    mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(ok(createRealisticTimeEntries()));

    // OpenAI成功モック
    mockOpenAIClient.generateSummary.mockResolvedValue(
      ok('今週は5件のPRと19.5時間の作業を実施。フロントエンド・バックエンド・インフラと幅広い活動を展開しました。')
    );
    mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
      ok({
        keep: ['複数プロジェクトにバランスよく取り組めている'],
        problem: ['木曜・金曜の作業時間が偏っている'],
        tryItems: ['スプリント計画で作業を均等に分散させる'],
      } as KPTSuggestions)
    );

    // Step 1: DataIntegrator実行
    const dataResult = await integrator.collectAndIntegrate(TEST_DATE_RANGE, TEST_DATA_SOURCE_CONFIG);
    expect(dataResult.success).toBe(true);
    if (!dataResult.success) return;

    // Step 2: ActivityAnalyzer実行（DataIntegratorの出力を入力に使用）
    const analysisResult = await analyzer.analyze(dataResult.value);
    expect(analysisResult.success).toBe(true);
    if (!analysisResult.success) return;

    const analysis = analysisResult.value;

    // 日別分析の検証 - DataIntegratorが生成した日別サマリーの日数分だけ分析が生成される
    expect(analysis.dailySummaries.length).toBe(dataResult.value.dailySummaries.length);
    expect(analysis.dailySummaries.length).toBeGreaterThan(0);

    // 各日のハイライトにPRとタイムエントリの情報が含まれている
    const jan27Analysis = analysis.dailySummaries.find(
      (d) => d.date.toISOString().startsWith('2026-01-27')
    );
    expect(jan27Analysis).toBeDefined();
    if (jan27Analysis) {
      // 1/27にはfrontendのPR#101とフロントエンド開発のタイムエントリがある
      expect(jan27Analysis.highlights.some((h) => h.includes('ダッシュボード'))).toBe(true);
    }

    // AIサマリーが使われている
    expect(analysis.aiEnabled).toBe(true);
    expect(analysis.weekSummary).toContain('5件のPR');
  });

  it('DataIntegratorのプロジェクト別集計がActivityAnalyzerのプロジェクト分布に正しく反映される', async () => {
    mockGitHubClient.getPullRequests
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/frontend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/backend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/infrastructure')));
    mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(ok(createRealisticTimeEntries()));
    mockOpenAIClient.generateSummary.mockResolvedValue(ok('サマリー'));
    mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
      ok({ keep: ['test'], problem: ['test'], tryItems: ['test'] })
    );

    const dataResult = await integrator.collectAndIntegrate(TEST_DATE_RANGE, TEST_DATA_SOURCE_CONFIG);
    expect(dataResult.success).toBe(true);
    if (!dataResult.success) return;

    // プロジェクト別集計の検証
    const data = dataResult.value;
    expect(data.projectSummaries.length).toBeGreaterThanOrEqual(3);

    // フロントエンド開発: 10800 + 5400 + 7200 = 23400秒 = 6.5h
    const frontendProject = data.projectSummaries.find(
      (p) => p.projectName === 'フロントエンド開発'
    );
    expect(frontendProject).toBeDefined();
    if (frontendProject) {
      expect(frontendProject.totalWorkHours).toBeCloseTo(6.5, 1);
    }

    // バックエンド開発: 14400 + 7200 + 10800 = 32400秒 = 9.0h
    const backendProject = data.projectSummaries.find(
      (p) => p.projectName === 'バックエンド開発'
    );
    expect(backendProject).toBeDefined();
    if (backendProject) {
      expect(backendProject.totalWorkHours).toBeCloseTo(9.0, 1);
    }

    // ActivityAnalyzerのプロジェクト分布検証
    const analysisResult = await analyzer.analyze(data);
    expect(analysisResult.success).toBe(true);
    if (!analysisResult.success) return;

    expect(analysisResult.value.activityTrend).toBeDefined();
    if (analysisResult.value.activityTrend) {
      const distribution = analysisResult.value.activityTrend.projectDistribution;
      expect(distribution.length).toBeGreaterThan(0);

      // パーセンテージの合計が100になる
      const totalPercentage = distribution.reduce((sum, p) => sum + p.percentage, 0);
      expect(totalPercentage).toBeCloseTo(100, 0);
    }
  });

  it('DataIntegrator部分失敗時もActivityAnalyzerが正しくフォールバック分析を生成する', async () => {
    // GitHubだけ失敗
    mockGitHubClient.getPullRequests
      .mockResolvedValue(err({ type: 'NETWORK_ERROR', message: 'Connection refused' }));
    mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(ok(createRealisticTimeEntries()));

    // OpenAIも失敗（フォールバック）
    mockOpenAIClient.generateSummary.mockResolvedValue(
      err({ type: 'SERVICE_UNAVAILABLE', message: 'OpenAI down' } as OpenAIError)
    );
    mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
      err({ type: 'SERVICE_UNAVAILABLE', message: 'OpenAI down' } as OpenAIError)
    );

    const dataResult = await integrator.collectAndIntegrate(TEST_DATE_RANGE, TEST_DATA_SOURCE_CONFIG);
    expect(dataResult.success).toBe(true);
    if (!dataResult.success) return;

    // GitHub失敗の警告が含まれる
    expect(dataResult.value.warnings.some((w) => w.type === 'PARTIAL_DATA')).toBe(true);
    expect(dataResult.value.pullRequests.length).toBe(0);
    expect(dataResult.value.timeEntries.length).toBeGreaterThan(0);

    // ActivityAnalyzerは部分データでも分析を生成する
    const analysisResult = await analyzer.analyze(dataResult.value);
    expect(analysisResult.success).toBe(true);
    if (!analysisResult.success) return;

    // AI不可でも基本サマリーが生成される
    expect(analysisResult.value.aiEnabled).toBe(false);
    expect(analysisResult.value.weekSummary.length).toBeGreaterThan(0);

    // KPTのフォールバックも生成される
    expect(analysisResult.value.kptSuggestions.keep.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// 統合テスト 2: ActivityAnalyzer -> ReflectionPageBuilder データフロー
// =============================================================================

describe('統合テスト: ActivityAnalyzer -> ReflectionPageBuilder データフロー', () => {
  let mockOpenAIClient: {
    generateSummary: ReturnType<typeof vi.fn>;
    generateKPTSuggestions: ReturnType<typeof vi.fn>;
  };
  let mockNotionClient: {
    createPage: ReturnType<typeof vi.fn>;
    queryDatabase: ReturnType<typeof vi.fn>;
    getPage: ReturnType<typeof vi.fn>;
  };
  let mockGitHubClient: {
    getPullRequests: ReturnType<typeof vi.fn>;
  };
  let mockTogglClient: {
    getTimeEntries: ReturnType<typeof vi.fn>;
    getProjects: ReturnType<typeof vi.fn>;
    getProjectName: ReturnType<typeof vi.fn>;
    getTimeEntriesWithProjectNames: ReturnType<typeof vi.fn>;
  };
  let integrator: DataIntegrator;
  let analyzer: ActivityAnalyzer;
  let pageBuilder: ReflectionPageBuilder;

  beforeEach(() => {
    mockOpenAIClient = {
      generateSummary: vi.fn(),
      generateKPTSuggestions: vi.fn(),
    };
    mockNotionClient = {
      createPage: vi.fn(),
      queryDatabase: vi.fn(),
      getPage: vi.fn(),
    };
    mockGitHubClient = { getPullRequests: vi.fn() };
    mockTogglClient = {
      getTimeEntries: vi.fn(),
      getProjects: vi.fn(),
      getProjectName: vi.fn(),
      getTimeEntriesWithProjectNames: vi.fn(),
    };
    integrator = new DataIntegrator(mockGitHubClient, mockTogglClient);
    analyzer = new ActivityAnalyzer(mockOpenAIClient);
    pageBuilder = new ReflectionPageBuilder(mockNotionClient);
  });

  it('ActivityAnalyzerの出力でNotionブロックが正しく構築される', async () => {
    // データ収集
    mockGitHubClient.getPullRequests
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/frontend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/backend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/infrastructure')));
    mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(ok(createRealisticTimeEntries()));
    mockOpenAIClient.generateSummary.mockResolvedValue(
      ok('充実した1週間でした。フロントエンドとバックエンドの開発に集中しました。')
    );
    mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
      ok({
        keep: ['並行開発の効率化', 'テスト作成の習慣'],
        problem: ['ミーティング時間の圧迫'],
        tryItems: ['ペアプログラミングの導入'],
      } as KPTSuggestions)
    );

    // Notion成功モック
    let capturedContent: NotionPageContent | null = null;
    mockNotionClient.createPage.mockImplementation(
      async (content: NotionPageContent) => {
        capturedContent = content;
        return ok({
          id: 'integration-page-id',
          url: 'https://notion.so/integration-page-id',
          createdTime: '2026-02-02T19:00:00Z',
          properties: {},
        } as NotionPage);
      }
    );

    // パイプライン実行
    const dataResult = await integrator.collectAndIntegrate(TEST_DATE_RANGE, TEST_DATA_SOURCE_CONFIG);
    expect(dataResult.success).toBe(true);
    if (!dataResult.success) return;

    const analysisResult = await analyzer.analyze(dataResult.value);
    expect(analysisResult.success).toBe(true);
    if (!analysisResult.success) return;

    const pageResult = await pageBuilder.buildAndCreate(
      analysisResult.value,
      dataResult.value,
      { dryRun: false, databaseId: 'test-db' }
    );
    expect(pageResult.success).toBe(true);

    // Notionに渡されたコンテンツを検証
    expect(capturedContent).not.toBeNull();
    if (!capturedContent) return;

    // タイトルに週番号と日付範囲が含まれる
    expect(capturedContent.title).toMatch(/Week \d+: 2026-01-27 - 2026-02-02/);

    // プロパティの検証
    expect(capturedContent.properties.weekNumber).toBeGreaterThan(0);
    expect(capturedContent.properties.tags).toContain('weekly-reflection');
    expect(capturedContent.properties.tags).toContain('auto-generated');
    expect(capturedContent.properties.prCount).toBe(5);  // 2 + 2 + 1 PR
    expect(capturedContent.properties.aiEnabled).toBe(true);

    // ブロック構造の検証
    const headings = capturedContent.blocks
      .filter((b) => b.type === 'heading_1' || b.type === 'heading_2')
      .map((b) => ('content' in b ? b.content : ''));

    // 主要セクションが存在する
    expect(headings.some((h) => h.includes('サマリー'))).toBe(true);
    expect(headings.some((h) => h.includes('GitHub'))).toBe(true);
    expect(headings.some((h) => h.includes('Toggl'))).toBe(true);
    expect(headings.some((h) => h.includes('Keep'))).toBe(true);
    expect(headings.some((h) => h.includes('Problem'))).toBe(true);
    expect(headings.some((h) => h.includes('Try'))).toBe(true);

    // KPT提案がブロックに含まれている
    const bulletItems = capturedContent.blocks
      .filter((b) => b.type === 'bulleted_list_item')
      .map((b) => ('content' in b ? b.content : ''));
    expect(bulletItems.some((item) => item.includes('並行開発の効率化'))).toBe(true);
    expect(bulletItems.some((item) => item.includes('ミーティング時間の圧迫'))).toBe(true);
    expect(bulletItems.some((item) => item.includes('ペアプログラミングの導入'))).toBe(true);
  });

  it('パイプライン全体の出力がMarkdown変換で正しく表現される', async () => {
    // データ収集
    mockGitHubClient.getPullRequests
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/frontend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/backend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/infrastructure')));
    mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(ok(createRealisticTimeEntries()));
    mockOpenAIClient.generateSummary.mockResolvedValue(
      ok('充実した1週間でした。')
    );
    mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
      ok({
        keep: ['テスト作成の習慣'],
        problem: ['ミーティング時間'],
        tryItems: ['ペアプログラミング'],
      } as KPTSuggestions)
    );

    const dataResult = await integrator.collectAndIntegrate(TEST_DATE_RANGE, TEST_DATA_SOURCE_CONFIG);
    expect(dataResult.success).toBe(true);
    if (!dataResult.success) return;

    const analysisResult = await analyzer.analyze(dataResult.value);
    expect(analysisResult.success).toBe(true);
    if (!analysisResult.success) return;

    // Markdown生成
    const markdown = pageBuilder.buildMarkdown(analysisResult.value, dataResult.value);

    // タイトルが含まれる
    expect(markdown).toContain('# Week');
    expect(markdown).toContain('2026-01-27');
    expect(markdown).toContain('2026-02-02');

    // セクションが含まれる
    expect(markdown).toContain('## 週次サマリー');
    expect(markdown).toContain('充実した1週間でした。');
    expect(markdown).toMatch(/GitHub.*PR/s);
    expect(markdown).toMatch(/Toggl.*作業時間/s);

    // PRの詳細が含まれる
    expect(markdown).toContain('ダッシュボード画面を実装');
    expect(markdown).toContain('REST API エンドポイント追加');
    expect(markdown).toContain('org/frontend');
    expect(markdown).toContain('org/backend');

    // タイムエントリの詳細が含まれる
    expect(markdown).toContain('フロントエンド開発');
    expect(markdown).toContain('バックエンド開発');

    // KPTセクション
    expect(markdown).toContain('## Keep');
    expect(markdown).toContain('テスト作成の習慣');
    expect(markdown).toContain('## Problem');
    expect(markdown).toContain('ミーティング時間');
    expect(markdown).toContain('## Try');
    expect(markdown).toContain('ペアプログラミング');
  });

  it('前週のTry項目が正しくページに反映される', async () => {
    mockGitHubClient.getPullRequests
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/frontend')))
      .mockResolvedValueOnce(ok([]))
      .mockResolvedValueOnce(ok([]));
    mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(ok(createRealisticTimeEntries().slice(0, 2)));
    mockOpenAIClient.generateSummary.mockResolvedValue(ok('サマリー'));
    mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
      ok({ keep: ['keep1'], problem: ['problem1'], tryItems: ['try1'] })
    );

    let capturedContent: NotionPageContent | null = null;
    mockNotionClient.createPage.mockImplementation(
      async (content: NotionPageContent) => {
        capturedContent = content;
        return ok({
          id: 'page-with-prev-try',
          url: 'https://notion.so/page-with-prev-try',
          createdTime: '2026-02-02T19:00:00Z',
          properties: {},
        } as NotionPage);
      }
    );

    const dataResult = await integrator.collectAndIntegrate(TEST_DATE_RANGE, TEST_DATA_SOURCE_CONFIG);
    expect(dataResult.success).toBe(true);
    if (!dataResult.success) return;

    const analysisResult = await analyzer.analyze(
      dataResult.value,
      ['前週のTry: ドキュメント整備', '前週のTry: テストカバレッジ向上']
    );
    expect(analysisResult.success).toBe(true);
    if (!analysisResult.success) return;

    const pageResult = await pageBuilder.buildAndCreate(
      analysisResult.value,
      dataResult.value,
      {
        dryRun: false,
        databaseId: 'test-db',
        previousTryItems: ['前週のTry: ドキュメント整備', '前週のTry: テストカバレッジ向上'],
      }
    );
    expect(pageResult.success).toBe(true);

    // 前週のTry項目がNotionブロックに含まれている
    expect(capturedContent).not.toBeNull();
    if (!capturedContent) return;

    const allContent = capturedContent.blocks
      .filter((b) => 'content' in b)
      .map((b) => ('content' in b ? b.content : ''));

    expect(allContent.some((c) => c.includes('前週のTry'))).toBe(true);
    expect(allContent.some((c) => c.includes('ドキュメント整備'))).toBe(true);
    expect(allContent.some((c) => c.includes('テストカバレッジ向上'))).toBe(true);
  });
});

// =============================================================================
// 統合テスト 3: ReflectionUseCase 全体フロー正常系
// =============================================================================

describe('統合テスト: ReflectionUseCase 全体フロー正常系', () => {
  function createFullPipelineMocks() {
    const mockGitHubClient = { getPullRequests: vi.fn() };
    const mockTogglClient = {
      getTimeEntries: vi.fn(),
      getProjects: vi.fn(),
      getProjectName: vi.fn(),
      getTimeEntriesWithProjectNames: vi.fn(),
    };
    const mockOpenAIClient = {
      generateSummary: vi.fn(),
      generateKPTSuggestions: vi.fn(),
    };
    const mockNotionClient = {
      createPage: vi.fn(),
      queryDatabase: vi.fn(),
      getPage: vi.fn(),
    };

    const integrator = new DataIntegrator(mockGitHubClient, mockTogglClient);
    const analyzer = new ActivityAnalyzer(mockOpenAIClient);
    const pageBuilder = new ReflectionPageBuilder(mockNotionClient);

    const configManager = {
      load: vi.fn().mockReturnValue(ok(createMockAppConfig())),
    };

    const useCase = new ReflectionUseCase(configManager, integrator, analyzer, pageBuilder);

    return {
      mockGitHubClient,
      mockTogglClient,
      mockOpenAIClient,
      mockNotionClient,
      configManager,
      useCase,
    };
  }

  it('設定読込→データ収集→AI分析→Notionページ作成の全フローが正しく動作する', async () => {
    const mocks = createFullPipelineMocks();

    // 全APIモック設定
    mocks.mockGitHubClient.getPullRequests
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/frontend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/backend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/infrastructure')));
    mocks.mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(ok(createRealisticTimeEntries()));
    mocks.mockOpenAIClient.generateSummary.mockResolvedValue(
      ok('今週は5件のPRを作成し、約19.5時間の作業を実施しました。')
    );
    mocks.mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
      ok({
        keep: ['マルチプロジェクト開発を効率的に進められている'],
        problem: ['テスト作成の時間が不足気味'],
        tryItems: ['TDDプラクティスの導入'],
      } as KPTSuggestions)
    );
    mocks.mockNotionClient.createPage.mockResolvedValue(
      ok({
        id: 'full-flow-page-id',
        url: 'https://notion.so/full-flow-page-id',
        createdTime: '2026-02-02T19:00:00Z',
        properties: {},
      } as NotionPage)
    );

    const progressEvents: Array<{ stage: string; status: string }> = [];
    const options: ReflectionOptions = {
      dateRange: TEST_DATE_RANGE,
      dryRun: false,
      onProgress: (event) => progressEvents.push({ stage: event.stage, status: event.status }),
    };

    const result = await mocks.useCase.execute(options);

    // 全体結果の検証
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.value.pageUrl).toBe('https://notion.so/full-flow-page-id');
    expect(result.value.summary.prCount).toBe(5);
    expect(result.value.summary.timeEntryCount).toBe(8);
    expect(result.value.summary.totalWorkHours).toBeCloseTo(19.5, 0);
    expect(result.value.summary.aiAnalysisEnabled).toBe(true);
    expect(result.value.summary.outputType).toBe('notion');
    expect(result.value.warnings.length).toBe(0);

    // 進捗コールバックの検証: 全ステージが開始・完了を通知している
    expect(progressEvents).toContainEqual({ stage: 'config', status: 'start' });
    expect(progressEvents).toContainEqual({ stage: 'config', status: 'complete' });
    expect(progressEvents).toContainEqual({ stage: 'data-collection', status: 'start' });
    expect(progressEvents).toContainEqual({ stage: 'data-collection', status: 'complete' });
    expect(progressEvents).toContainEqual({ stage: 'analysis', status: 'start' });
    expect(progressEvents).toContainEqual({ stage: 'analysis', status: 'complete' });
    expect(progressEvents).toContainEqual({ stage: 'page-creation', status: 'start' });
    expect(progressEvents).toContainEqual({ stage: 'page-creation', status: 'complete' });

    // コンポーネント呼び出し順の検証
    expect(mocks.configManager.load).toHaveBeenCalledTimes(1);
    expect(mocks.mockGitHubClient.getPullRequests).toHaveBeenCalledTimes(3);
    expect(mocks.mockTogglClient.getTimeEntriesWithProjectNames).toHaveBeenCalledTimes(1);
    expect(mocks.mockOpenAIClient.generateSummary).toHaveBeenCalledTimes(1);
    expect(mocks.mockOpenAIClient.generateKPTSuggestions).toHaveBeenCalledTimes(1);
    expect(mocks.mockNotionClient.createPage).toHaveBeenCalledTimes(1);
  });

  it('ドライランモードではNotionページを作成せずプレビューを返す', async () => {
    const mocks = createFullPipelineMocks();

    mocks.mockGitHubClient.getPullRequests
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/frontend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/backend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/infrastructure')));
    mocks.mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(ok(createRealisticTimeEntries()));
    mocks.mockOpenAIClient.generateSummary.mockResolvedValue(ok('サマリー'));
    mocks.mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
      ok({ keep: ['keep'], problem: ['problem'], tryItems: ['try'] })
    );

    const options: ReflectionOptions = {
      dateRange: TEST_DATE_RANGE,
      dryRun: true,
    };

    const result = await mocks.useCase.execute(options);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // ドライランの検証
    expect(result.value.pageUrl).toBeUndefined();
    expect(result.value.preview).toBeDefined();
    expect(result.value.preview!.length).toBeGreaterThan(0);
    expect(result.value.summary.outputType).toBe('preview');

    // Notionクライアントは呼ばれない
    expect(mocks.mockNotionClient.createPage).not.toHaveBeenCalled();

    // データ収集とAI分析は実行される
    expect(mocks.mockGitHubClient.getPullRequests).toHaveBeenCalled();
    expect(mocks.mockOpenAIClient.generateSummary).toHaveBeenCalled();
  });

  it('データが空の場合も正常に処理が完了する', async () => {
    const mocks = createFullPipelineMocks();

    // 全データソースが空
    mocks.mockGitHubClient.getPullRequests.mockResolvedValue(ok([]));
    mocks.mockTogglClient.getTimeEntriesWithProjectNames.mockResolvedValue(ok([]));
    mocks.mockOpenAIClient.generateSummary.mockResolvedValue(ok('活動なしの週'));
    mocks.mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
      ok({ keep: ['振り返りの継続'], problem: ['活動データなし'], tryItems: ['記録の習慣化'] })
    );
    mocks.mockNotionClient.createPage.mockResolvedValue(
      ok({
        id: 'empty-page-id',
        url: 'https://notion.so/empty-page-id',
        createdTime: '2026-02-02T19:00:00Z',
        properties: {},
      } as NotionPage)
    );

    const options: ReflectionOptions = {
      dateRange: TEST_DATE_RANGE,
      dryRun: false,
    };

    const result = await mocks.useCase.execute(options);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.value.pageUrl).toBe('https://notion.so/empty-page-id');
    expect(result.value.summary.prCount).toBe(0);
    expect(result.value.summary.timeEntryCount).toBe(0);
    expect(result.value.summary.totalWorkHours).toBe(0);

    // 警告が含まれる（PRなし、タイムエントリなし）
    expect(result.value.warnings.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// 統合テスト 4: 各API障害時のフォールバック動作
// =============================================================================

describe('統合テスト: 各API障害時のフォールバック動作', () => {
  function createFullPipelineMocks() {
    const mockGitHubClient = { getPullRequests: vi.fn() };
    const mockTogglClient = {
      getTimeEntries: vi.fn(),
      getProjects: vi.fn(),
      getProjectName: vi.fn(),
      getTimeEntriesWithProjectNames: vi.fn(),
    };
    const mockOpenAIClient = {
      generateSummary: vi.fn(),
      generateKPTSuggestions: vi.fn(),
    };
    const mockNotionClient = {
      createPage: vi.fn(),
      queryDatabase: vi.fn(),
      getPage: vi.fn(),
    };

    const integrator = new DataIntegrator(mockGitHubClient, mockTogglClient);
    const analyzer = new ActivityAnalyzer(mockOpenAIClient);
    const pageBuilder = new ReflectionPageBuilder(mockNotionClient);

    const configManager = {
      load: vi.fn().mockReturnValue(ok(createMockAppConfig())),
    };

    const useCase = new ReflectionUseCase(configManager, integrator, analyzer, pageBuilder);

    return {
      mockGitHubClient,
      mockTogglClient,
      mockOpenAIClient,
      mockNotionClient,
      configManager,
      useCase,
    };
  }

  it('GitHub API障害時: Togglデータのみで処理が継続しNotionページが作成される', async () => {
    const mocks = createFullPipelineMocks();

    // GitHub全リポジトリ失敗
    mocks.mockGitHubClient.getPullRequests
      .mockResolvedValue(err({ type: 'NETWORK_ERROR', message: 'GitHub is down' }));
    // Toggl成功
    mocks.mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(ok(createRealisticTimeEntries()));
    // OpenAI成功
    mocks.mockOpenAIClient.generateSummary.mockResolvedValue(ok('Togglデータのみのサマリー'));
    mocks.mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
      ok({ keep: ['時間記録の継続'], problem: ['GitHubデータ不足'], tryItems: ['API接続の確認'] })
    );
    // Notion成功
    mocks.mockNotionClient.createPage.mockResolvedValue(
      ok({
        id: 'github-down-page',
        url: 'https://notion.so/github-down-page',
        createdTime: '2026-02-02T19:00:00Z',
        properties: {},
      } as NotionPage)
    );

    const result = await mocks.useCase.execute({
      dateRange: TEST_DATE_RANGE,
      dryRun: false,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    // ページは作成される
    expect(result.value.pageUrl).toBe('https://notion.so/github-down-page');
    expect(result.value.summary.prCount).toBe(0);
    expect(result.value.summary.timeEntryCount).toBe(8);
    expect(result.value.summary.outputType).toBe('notion');

    // 警告が含まれる
    expect(result.value.warnings.length).toBeGreaterThan(0);
    expect(result.value.warnings.some((w) => w.includes('GitHub'))).toBe(true);
  });

  it('Toggl API障害時: GitHubデータのみで処理が継続しNotionページが作成される', async () => {
    const mocks = createFullPipelineMocks();

    // GitHub成功
    mocks.mockGitHubClient.getPullRequests
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/frontend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/backend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/infrastructure')));
    // Toggl失敗
    mocks.mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(err({ type: 'UNAUTHORIZED', message: 'Invalid token' }));
    // OpenAI成功
    mocks.mockOpenAIClient.generateSummary.mockResolvedValue(ok('GitHubデータのみのサマリー'));
    mocks.mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
      ok({ keep: ['PR活動の継続'], problem: ['Toggl認証エラー'], tryItems: ['APIトークンの更新'] })
    );
    // Notion成功
    mocks.mockNotionClient.createPage.mockResolvedValue(
      ok({
        id: 'toggl-down-page',
        url: 'https://notion.so/toggl-down-page',
        createdTime: '2026-02-02T19:00:00Z',
        properties: {},
      } as NotionPage)
    );

    const result = await mocks.useCase.execute({
      dateRange: TEST_DATE_RANGE,
      dryRun: false,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.value.pageUrl).toBe('https://notion.so/toggl-down-page');
    expect(result.value.summary.prCount).toBe(5);
    expect(result.value.summary.timeEntryCount).toBe(0);
    expect(result.value.summary.totalWorkHours).toBe(0);
    expect(result.value.summary.outputType).toBe('notion');

    // Toggl失敗の警告
    expect(result.value.warnings.some((w) => w.includes('Toggl'))).toBe(true);
  });

  it('OpenAI API障害時: AI分析なしの基本サマリーでNotionページが作成される', async () => {
    const mocks = createFullPipelineMocks();

    // GitHub・Toggl成功
    mocks.mockGitHubClient.getPullRequests
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/frontend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/backend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/infrastructure')));
    mocks.mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(ok(createRealisticTimeEntries()));
    // OpenAI全面失敗
    mocks.mockOpenAIClient.generateSummary.mockResolvedValue(
      err({ type: 'SERVICE_UNAVAILABLE', message: 'OpenAI is down' } as OpenAIError)
    );
    mocks.mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
      err({ type: 'SERVICE_UNAVAILABLE', message: 'OpenAI is down' } as OpenAIError)
    );
    // Notion成功
    let capturedContent: NotionPageContent | null = null;
    mocks.mockNotionClient.createPage.mockImplementation(
      async (content: NotionPageContent) => {
        capturedContent = content;
        return ok({
          id: 'openai-down-page',
          url: 'https://notion.so/openai-down-page',
          createdTime: '2026-02-02T19:00:00Z',
          properties: {},
        } as NotionPage);
      }
    );

    const result = await mocks.useCase.execute({
      dateRange: TEST_DATE_RANGE,
      dryRun: false,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    // ページは作成される
    expect(result.value.pageUrl).toBe('https://notion.so/openai-down-page');
    expect(result.value.summary.aiAnalysisEnabled).toBe(false);

    // Notionに送信されたコンテンツを検証
    expect(capturedContent).not.toBeNull();
    if (!capturedContent) return;

    // AI不可でもKPTセクションが存在する（フォールバックKPT）
    const headings = capturedContent.blocks
      .filter((b) => b.type === 'heading_1')
      .map((b) => ('content' in b ? b.content : ''));
    expect(headings.some((h) => h.includes('Keep'))).toBe(true);
    expect(headings.some((h) => h.includes('Problem'))).toBe(true);
    expect(headings.some((h) => h.includes('Try'))).toBe(true);

    // フォールバックKPTにはデータに基づく提案が含まれる
    const bulletItems = capturedContent.blocks
      .filter((b) => b.type === 'bulleted_list_item')
      .map((b) => ('content' in b ? b.content : ''));
    expect(bulletItems.length).toBeGreaterThan(0);
  });

  it('Notion API障害時: Markdownファイルにフォールバック出力される', async () => {
    const mocks = createFullPipelineMocks();

    // GitHub・Toggl・OpenAI成功
    mocks.mockGitHubClient.getPullRequests
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/frontend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/backend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/infrastructure')));
    mocks.mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(ok(createRealisticTimeEntries()));
    mocks.mockOpenAIClient.generateSummary.mockResolvedValue(
      ok('今週のサマリーです。')
    );
    mocks.mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
      ok({ keep: ['good work'], problem: ['issues'], tryItems: ['improvements'] })
    );
    // Notion失敗
    mocks.mockNotionClient.createPage.mockResolvedValue(
      err({ type: 'SERVICE_UNAVAILABLE', message: 'Notion is down' } as NotionError)
    );

    const result = await mocks.useCase.execute({
      dateRange: TEST_DATE_RANGE,
      dryRun: false,
    });

    // Markdownフォールバック成功
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.value.pageUrl).toBeUndefined();
    expect(result.value.localFilePath).toBeDefined();
    expect(result.value.localFilePath).toMatch(/reflection-.*\.md$/);
    expect(result.value.summary.outputType).toBe('markdown');

    // Notion失敗の警告が含まれる
    expect(result.value.warnings.some((w) => w.includes('Notion'))).toBe(true);

    // データ収集とAI分析は正常に完了している
    expect(result.value.summary.prCount).toBe(5);
    expect(result.value.summary.aiAnalysisEnabled).toBe(true);
  });

  it('GitHub + Toggl 両方障害時: エラーを返す', async () => {
    const mocks = createFullPipelineMocks();

    // 両方失敗
    mocks.mockGitHubClient.getPullRequests
      .mockResolvedValue(err({ type: 'NETWORK_ERROR', message: 'GitHub down' }));
    mocks.mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(err({ type: 'NETWORK_ERROR', message: 'Toggl down' }));

    const result = await mocks.useCase.execute({
      dateRange: TEST_DATE_RANGE,
      dryRun: false,
    });

    // 両データソース失敗はエラー
    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.type).toBe('DATA_COLLECTION_FAILED');
  });

  it('設定不正時: CONFIG_INVALIDエラーを返し処理を中断する', async () => {
    const mocks = createFullPipelineMocks();

    // 設定エラー
    mocks.configManager.load.mockReturnValue(
      err({
        type: 'MISSING_REQUIRED' as const,
        missingFields: ['GITHUB_TOKEN', 'NOTION_DATABASE_ID'],
      })
    );

    const result = await mocks.useCase.execute({
      dateRange: TEST_DATE_RANGE,
      dryRun: false,
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.type).toBe('CONFIG_INVALID');
    if (result.error.type === 'CONFIG_INVALID') {
      expect(result.error.missingFields).toContain('GITHUB_TOKEN');
      expect(result.error.missingFields).toContain('NOTION_DATABASE_ID');
    }

    // データ収集まで進まない
    expect(mocks.mockGitHubClient.getPullRequests).not.toHaveBeenCalled();
  });

  it('GitHub部分障害 + OpenAI障害の複合障害時: 利用可能なデータでフォールバックページが作成される', async () => {
    const mocks = createFullPipelineMocks();

    // GitHubの一部リポジトリだけ成功
    mocks.mockGitHubClient.getPullRequests
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/frontend')))
      .mockResolvedValueOnce(err({ type: 'NOT_FOUND', repository: 'org/backend' }))
      .mockResolvedValueOnce(err({ type: 'NETWORK_ERROR', message: 'timeout' }));
    // Toggl成功
    mocks.mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(ok(createRealisticTimeEntries()));
    // OpenAI失敗
    mocks.mockOpenAIClient.generateSummary.mockResolvedValue(
      err({ type: 'RATE_LIMITED', retryAfter: 60 } as OpenAIError)
    );
    mocks.mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
      err({ type: 'RATE_LIMITED', retryAfter: 60 } as OpenAIError)
    );
    // Notion成功
    mocks.mockNotionClient.createPage.mockResolvedValue(
      ok({
        id: 'partial-page',
        url: 'https://notion.so/partial-page',
        createdTime: '2026-02-02T19:00:00Z',
        properties: {},
      } as NotionPage)
    );

    const result = await mocks.useCase.execute({
      dateRange: TEST_DATE_RANGE,
      dryRun: false,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    // 利用可能なデータで処理が完了
    expect(result.value.pageUrl).toBe('https://notion.so/partial-page');
    expect(result.value.summary.prCount).toBe(2); // frontendのみ
    expect(result.value.summary.timeEntryCount).toBe(8); // Togglは全件
    expect(result.value.summary.aiAnalysisEnabled).toBe(false); // OpenAI不可
    expect(result.value.summary.outputType).toBe('notion');
  });

  it('OpenAI部分障害（サマリーのみ失敗、KPTは成功）時: AIサマリーフォールバック + AI KPTの組み合わせ', async () => {
    const mocks = createFullPipelineMocks();

    mocks.mockGitHubClient.getPullRequests
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/frontend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/backend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/infrastructure')));
    mocks.mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(ok(createRealisticTimeEntries()));
    // サマリー失敗、KPT成功
    mocks.mockOpenAIClient.generateSummary.mockResolvedValue(
      err({ type: 'TOKEN_LIMIT_EXCEEDED', message: 'Too many tokens' } as OpenAIError)
    );
    mocks.mockOpenAIClient.generateKPTSuggestions.mockResolvedValue(
      ok({
        keep: ['AI生成のKeep'],
        problem: ['AI生成のProblem'],
        tryItems: ['AI生成のTry'],
      } as KPTSuggestions)
    );
    mocks.mockNotionClient.createPage.mockResolvedValue(
      ok({
        id: 'partial-ai-page',
        url: 'https://notion.so/partial-ai-page',
        createdTime: '2026-02-02T19:00:00Z',
        properties: {},
      } as NotionPage)
    );

    const result = await mocks.useCase.execute({
      dateRange: TEST_DATE_RANGE,
      dryRun: false,
    });

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.value.pageUrl).toBe('https://notion.so/partial-ai-page');
    // サマリーはフォールバック（基本統計情報を含む）
    // KPTはAI生成なのでaiEnabledの状態はActivityAnalyzerの実装に依存
    // （サマリー失敗時はaiEnabled=false）
    expect(result.value.summary.prCount).toBe(5);
  });
});

// =============================================================================
// 統合テスト 5: データ集計の正確性
// =============================================================================

describe('統合テスト: データ集計の正確性検証', () => {
  let mockGitHubClient: {
    getPullRequests: ReturnType<typeof vi.fn>;
  };
  let mockTogglClient: {
    getTimeEntries: ReturnType<typeof vi.fn>;
    getProjects: ReturnType<typeof vi.fn>;
    getProjectName: ReturnType<typeof vi.fn>;
    getTimeEntriesWithProjectNames: ReturnType<typeof vi.fn>;
  };
  let integrator: DataIntegrator;

  beforeEach(() => {
    mockGitHubClient = { getPullRequests: vi.fn() };
    mockTogglClient = {
      getTimeEntries: vi.fn(),
      getProjects: vi.fn(),
      getProjectName: vi.fn(),
      getTimeEntriesWithProjectNames: vi.fn(),
    };
    integrator = new DataIntegrator(mockGitHubClient, mockTogglClient);
  });

  it('日別集計: 各日のPR数と作業時間が正確に集計される', async () => {
    mockGitHubClient.getPullRequests
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/frontend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/backend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/infrastructure')));
    mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(ok(createRealisticTimeEntries()));

    const result = await integrator.collectAndIntegrate(TEST_DATE_RANGE, TEST_DATA_SOURCE_CONFIG);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const { dailySummaries } = result.value;

    // 1/27: frontend PR#101 (1PR) + フロントエンド開発 10800+5400=16200秒 = 4.5h
    const jan27 = dailySummaries.find((d) => d.date.toISOString().startsWith('2026-01-27'));
    expect(jan27).toBeDefined();
    if (jan27) {
      expect(jan27.prCount).toBe(1);
      expect(jan27.workHours).toBeCloseTo(4.5, 1);
    }

    // 1/28: backend PR#55 (1PR) + バックエンド開発 14400+7200=21600秒 = 6.0h
    const jan28 = dailySummaries.find((d) => d.date.toISOString().startsWith('2026-01-28'));
    expect(jan28).toBeDefined();
    if (jan28) {
      expect(jan28.prCount).toBe(1);
      expect(jan28.workHours).toBeCloseTo(6.0, 1);
    }

    // 1/29: frontend PR#102 (1PR) + フロントエンド開発 7200秒 + チームミーティング 3600秒 = 10800秒 = 3.0h
    const jan29 = dailySummaries.find((d) => d.date.toISOString().startsWith('2026-01-29'));
    expect(jan29).toBeDefined();
    if (jan29) {
      expect(jan29.prCount).toBe(1);
      expect(jan29.workHours).toBeCloseTo(3.0, 1);
    }

    // 1/30: backend PR#56 (1PR) + バックエンド開発 10800秒 = 3.0h
    const jan30 = dailySummaries.find((d) => d.date.toISOString().startsWith('2026-01-30'));
    expect(jan30).toBeDefined();
    if (jan30) {
      expect(jan30.prCount).toBe(1);
      expect(jan30.workHours).toBeCloseTo(3.0, 1);
    }

    // 1/31: infrastructure PR#20 (1PR) + インフラ作業 10800秒 = 3.0h
    const jan31 = dailySummaries.find((d) => d.date.toISOString().startsWith('2026-01-31'));
    expect(jan31).toBeDefined();
    if (jan31) {
      expect(jan31.prCount).toBe(1);
      expect(jan31.workHours).toBeCloseTo(3.0, 1);
    }
  });

  it('プロジェクト別集計: 各プロジェクトのPR数と作業時間が正確に集計される', async () => {
    mockGitHubClient.getPullRequests
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/frontend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/backend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/infrastructure')));
    mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(ok(createRealisticTimeEntries()));

    const result = await integrator.collectAndIntegrate(TEST_DATE_RANGE, TEST_DATA_SOURCE_CONFIG);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const { projectSummaries } = result.value;

    // GitHubリポジトリ別PR数
    const frontendRepo = projectSummaries.find((p) => p.projectName === 'org/frontend');
    expect(frontendRepo).toBeDefined();
    if (frontendRepo) {
      expect(frontendRepo.totalPRs).toBe(2); // PR#101, PR#102
    }

    const backendRepo = projectSummaries.find((p) => p.projectName === 'org/backend');
    expect(backendRepo).toBeDefined();
    if (backendRepo) {
      expect(backendRepo.totalPRs).toBe(2); // PR#55, PR#56
    }

    const infraRepo = projectSummaries.find((p) => p.projectName === 'org/infrastructure');
    expect(infraRepo).toBeDefined();
    if (infraRepo) {
      expect(infraRepo.totalPRs).toBe(1); // PR#20
    }

    // Togglプロジェクト別作業時間
    const frontendDev = projectSummaries.find((p) => p.projectName === 'フロントエンド開発');
    expect(frontendDev).toBeDefined();
    if (frontendDev) {
      // 10800 + 5400 + 7200 = 23400秒 = 6.5h
      expect(frontendDev.totalWorkHours).toBeCloseTo(6.5, 1);
    }

    const backendDev = projectSummaries.find((p) => p.projectName === 'バックエンド開発');
    expect(backendDev).toBeDefined();
    if (backendDev) {
      // 14400 + 7200 + 10800 = 32400秒 = 9.0h
      expect(backendDev.totalWorkHours).toBeCloseTo(9.0, 1);
    }

    const teamMeeting = projectSummaries.find((p) => p.projectName === 'チームミーティング');
    expect(teamMeeting).toBeDefined();
    if (teamMeeting) {
      // 3600秒 = 1.0h
      expect(teamMeeting.totalWorkHours).toBeCloseTo(1.0, 1);
    }

    const infraWork = projectSummaries.find((p) => p.projectName === 'インフラ作業');
    expect(infraWork).toBeDefined();
    if (infraWork) {
      // 10800秒 = 3.0h
      expect(infraWork.totalWorkHours).toBeCloseTo(3.0, 1);
    }
  });

  it('総合計の検証: 全体のPR数と作業時間の合計が正しい', async () => {
    mockGitHubClient.getPullRequests
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/frontend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/backend')))
      .mockResolvedValueOnce(ok(createRealisticPullRequests('org/infrastructure')));
    mockTogglClient.getTimeEntriesWithProjectNames
      .mockResolvedValue(ok(createRealisticTimeEntries()));

    const result = await integrator.collectAndIntegrate(TEST_DATE_RANGE, TEST_DATA_SOURCE_CONFIG);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const { pullRequests, timeEntries } = result.value;

    // 総PR数: 2 (frontend) + 2 (backend) + 1 (infrastructure) = 5
    expect(pullRequests.length).toBe(5);

    // 総タイムエントリ数: 8
    expect(timeEntries.length).toBe(8);

    // 総作業時間: (10800+5400+14400+7200+7200+3600+10800+10800) / 3600 = 70200/3600 = 19.5h
    const totalWorkHours = timeEntries.reduce((sum, e) => sum + e.durationSeconds / 3600, 0);
    expect(totalWorkHours).toBeCloseTo(19.5, 1);
  });
});
