#!/usr/bin/env npx tsx
/**
 * ReflectionUseCase 手動確認スクリプト
 *
 * 使用方法:
 *   npx tsx scripts/test-reflection-usecase.ts              # 直近7日間（ドライラン）
 *   npx tsx scripts/test-reflection-usecase.ts 14            # 直近14日間
 *   npx tsx scripts/test-reflection-usecase.ts --no-ai       # AI分析なしで実行
 *   npx tsx scripts/test-reflection-usecase.ts --no-ai 3     # 直近3日間、AI分析なし
 *
 * ドライランモードで実行するため、Notionページは作成されません。
 * Markdownプレビューが表示されます。
 */

import { config } from 'dotenv';
config();

import { ConfigManager } from '../src/infrastructure/config/config-manager.js';
import { GitHubClient } from '../src/infrastructure/clients/github-client.js';
import { TogglClient } from '../src/infrastructure/clients/toggl-client.js';
import { OpenAIClient } from '../src/infrastructure/clients/openai-client.js';
import { DataIntegrator } from '../src/domain/data-integrator.js';
import { ActivityAnalyzer } from '../src/domain/activity-analyzer.js';
import { ReflectionPageBuilder } from '../src/domain/reflection-page-builder.js';
import { ReflectionUseCase } from '../src/application/reflection-use-case.js';
import type { ProgressEvent } from '../src/application/reflection-use-case.js';

// 引数のパース
const args = process.argv.slice(2);
const noAI = args.includes('--no-ai');
const daysArg = args.find((a) => !a.startsWith('--'));
const days = parseInt(daysArg || '7', 10);

// ── Step 1: 設定読み込み ──
console.log('\n🔧 ReflectionUseCase 手動確認（ドライラン）');
console.log('='.repeat(60));

const configManager = new ConfigManager();
const configResult = configManager.load();

if (!configResult.success) {
  console.error('❌ 設定の読み込みに失敗しました:');
  console.error(`   不足フィールド: ${configResult.error.missingFields.join(', ')}`);
  console.error('\n   .env ファイルを確認してください。');
  process.exit(1);
}

const appConfig = configResult.value;
const masked = configManager.maskSensitiveData(appConfig);

console.log(`📅 期間: 直近 ${days} 日間`);
console.log(`📁 リポジトリ: ${appConfig.github.repositories.join(', ')}`);
console.log(`🤖 AIモデル: ${noAI ? '無効' : appConfig.openai.model}`);
console.log(`🔑 GitHub: ${masked.github.token}`);
console.log(`🔑 Toggl: ${masked.toggl.apiToken}`);
console.log(`🔑 OpenAI: ${masked.openai.apiKey}`);
console.log('='.repeat(60));

// ── Step 2: 依存コンポーネントの組み立て ──

const githubClient = new GitHubClient({ token: appConfig.github.token });
const togglClient = new TogglClient({ apiToken: appConfig.toggl.apiToken });
const dataIntegrator = new DataIntegrator(githubClient, togglClient);

// AI無効モード: OpenAIClient のスタブを使う
const openaiClient = noAI
  ? {
      async generateSummary() {
        return { success: false as const, error: { type: 'SERVICE_UNAVAILABLE' as const, message: 'AI disabled by --no-ai flag' } };
      },
      async generateKPTSuggestions() {
        return { success: false as const, error: { type: 'SERVICE_UNAVAILABLE' as const, message: 'AI disabled by --no-ai flag' } };
      },
    }
  : new OpenAIClient({ apiKey: appConfig.openai.apiKey, model: appConfig.openai.model });

const activityAnalyzer = new ActivityAnalyzer(openaiClient);

// NotionClient はドライランなので呼ばれないが、型を満たすスタブを渡す
const notionStub = {
  async createPage() {
    return { success: false as const, error: { type: 'SERVICE_UNAVAILABLE' as const, message: 'Stub - should not be called in dry run' } };
  },
};
const pageBuilder = new ReflectionPageBuilder(notionStub as never);

// ── ConfigManager をラップ（UseCase の IConfigManager インターフェースに合わせる） ──
const configManagerForUseCase = {
  load() {
    return configResult;
  },
};

const useCase = new ReflectionUseCase(
  configManagerForUseCase,
  dataIntegrator,
  activityAnalyzer,
  pageBuilder
);

// ── Step 3: 進捗コールバック ──

const stageLabels: Record<string, string> = {
  config: '⚙️  設定読込',
  'data-collection': '📊 データ収集',
  analysis: '🤖 活動分析',
  'page-creation': '📝 ページ生成',
};

function onProgress(event: ProgressEvent): void {
  const label = stageLabels[event.stage] || event.stage;
  const statusIcon =
    event.status === 'start' ? '🔄' : event.status === 'complete' ? '✅' : '❌';
  const msg = event.message ? ` (${event.message})` : '';
  console.log(`${statusIcon} ${label}${msg}`);
}

// ── Step 4: 実行 ──

const end = new Date();
const start = new Date();
start.setDate(start.getDate() - days);

console.log('\n🚀 実行開始\n');

const startTime = Date.now();

const result = await useCase.execute({
  dateRange: { start, end },
  dryRun: true,
  onProgress,
});

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

// ── Step 5: 結果表示 ──

console.log('\n' + '='.repeat(60));

if (!result.success) {
  console.error(`❌ 実行失敗 (${elapsed}s)`);
  console.error(`   エラー種別: ${result.error.type}`);
  if (result.error.type === 'CONFIG_INVALID') {
    console.error(`   不足フィールド: ${result.error.missingFields.join(', ')}`);
  } else if (result.error.type === 'DATA_COLLECTION_FAILED') {
    console.error(`   ${result.error.source}: ${result.error.message}`);
  } else {
    console.error(`   ${result.error.message}`);
  }
  process.exit(1);
}

const { summary, warnings, preview } = result.value;

console.log(`✅ 実行完了 (${elapsed}s)\n`);

// サマリー
console.log('📋 実行サマリー');
console.log('─'.repeat(40));
console.log(`   期間:          ${summary.dateRange.start.toISOString().split('T')[0]} ~ ${summary.dateRange.end.toISOString().split('T')[0]}`);
console.log(`   PR数:          ${summary.prCount} 件`);
console.log(`   タイムエントリ: ${summary.timeEntryCount} 件`);
console.log(`   総作業時間:    ${summary.totalWorkHours.toFixed(1)} 時間`);
console.log(`   AI分析:        ${summary.aiAnalysisEnabled ? '有効' : '無効（フォールバック）'}`);
console.log(`   出力タイプ:    ${summary.outputType}`);

// 警告
if (warnings.length > 0) {
  console.log('\n⚠️  警告:');
  for (const warning of warnings) {
    console.log(`   - ${warning}`);
  }
}

// Markdownプレビュー
if (preview) {
  console.log('\n' + '━'.repeat(60));
  console.log('📄 Markdownプレビュー');
  console.log('━'.repeat(60));
  console.log(preview);
  console.log('━'.repeat(60));
}

console.log('\n✅ 完了\n');
