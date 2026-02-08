#!/usr/bin/env node

/**
 * CLI エントリーポイント - 振り返り生成メインコマンド
 *
 * Commander.jsベースのCLIアプリケーション。
 * 実際の依存関係を注入してユースケースを実行する。
 *
 * 使用例:
 *   npx reflection-weekly
 *   npx reflection-weekly --start 2026-01-27 --end 2026-02-02
 *   npx reflection-weekly --dry-run
 *   npx reflection-weekly --verbose
 */

import { ConfigManager } from '../infrastructure/config/config-manager.js';
import { DataIntegrator } from '../domain/data-integrator.js';
import { ActivityAnalyzer } from '../domain/activity-analyzer.js';
import { ReflectionPageBuilder } from '../domain/reflection-page-builder.js';
import { GitHubClient } from '../infrastructure/clients/github-client.js';
import { TogglClient } from '../infrastructure/clients/toggl-client.js';
import { OpenAIClient } from '../infrastructure/clients/openai-client.js';
import { NotionClient } from '../infrastructure/clients/notion-client.js';
import { ReflectionUseCase } from '../application/reflection-use-case.js';
import { runCLI, formatSummary } from './cli.js';

/**
 * メイン実行関数
 */
async function main(): Promise<void> {
  // 依存関係の構築
  const configManager = new ConfigManager();
  const configResult = configManager.load();

  // 設定読み込みに基づいてクライアントを初期化
  // （設定エラーはユースケース内で検出される）
  let githubClient: GitHubClient;
  let togglClient: TogglClient;
  let openaiClient: OpenAIClient;
  let notionClient: NotionClient;

  if (configResult.success) {
    const config = configResult.value;
    githubClient = new GitHubClient({ token: config.github.token });
    togglClient = new TogglClient({ apiToken: config.toggl.apiToken });
    openaiClient = new OpenAIClient({ apiKey: config.openai.apiKey, model: config.openai.model });
    notionClient = new NotionClient({ token: config.notion.token });
  } else {
    // 設定が不正でもクライアントをダミー初期化（ユースケース内でエラーハンドリング）
    githubClient = new GitHubClient({ token: '' });
    togglClient = new TogglClient({ apiToken: '' });
    openaiClient = new OpenAIClient({ apiKey: '' });
    notionClient = new NotionClient({ token: '' });
  }

  const dataIntegrator = new DataIntegrator(githubClient, togglClient);
  const activityAnalyzer = new ActivityAnalyzer(openaiClient);
  const pageBuilder = new ReflectionPageBuilder(notionClient);

  const useCase = new ReflectionUseCase(
    configManager,
    dataIntegrator,
    activityAnalyzer,
    pageBuilder
  );

  // CLI実行
  const args = process.argv.slice(2);
  const result = await runCLI(args, (options) => useCase.execute(options));

  // 結果出力
  if (result.success) {
    const summaryOutput = formatSummary({
      pageUrl: result.pageUrl,
      localFilePath: result.localFilePath,
      summary: result.summary,
      warnings: result.warnings,
    });
    process.stdout.write(summaryOutput + '\n');
    process.exit(0);
  } else {
    // エラー時は既にユースケース内でハンドリングされているため、
    // ここではサマリーの出力のみ
    process.stderr.write('\n振り返り生成に失敗しました。\n');
    process.exit(1);
  }
}

// エントリーポイント実行
main().catch((error: unknown) => {
  process.stderr.write(`予期しないエラーが発生しました: ${String(error)}\n`);
  process.exit(1);
});
