#!/usr/bin/env npx tsx
/**
 * DataIntegrator 手動確認スクリプト
 * 使用方法: npx tsx scripts/test-data-integrator.ts [options] [days]
 * 例:
 *   npx tsx scripts/test-data-integrator.ts              # 直近7日間（サマリーのみ）
 *   npx tsx scripts/test-data-integrator.ts 14            # 直近14日間
 *   npx tsx scripts/test-data-integrator.ts --detail       # diff付きで表示
 *   npx tsx scripts/test-data-integrator.ts --detail 3     # 直近3日間、diff付き
 */

import { config } from 'dotenv';
config();

import { GitHubClient } from '../src/infrastructure/clients/github-client.js';
import { TogglClient } from '../src/infrastructure/clients/toggl-client.js';
import { DataIntegrator } from '../src/domain/data-integrator.js';

// 引数のパース
const args = process.argv.slice(2);
const showDetail = args.includes('--detail');
const daysArg = args.find((a) => !a.startsWith('--'));
const days = parseInt(daysArg || '7', 10);

// 環境変数の検証
const githubToken = process.env.GITHUB_TOKEN;
const togglApiToken = process.env.TOGGL_API_TOKEN;
const repositories = process.env.GITHUB_REPOSITORIES;
const workspaceId = process.env.TOGGL_WORKSPACE_ID;

if (!githubToken || !togglApiToken || !repositories) {
  console.error('❌ 必要な環境変数が設定されていません。.env ファイルを確認してください。');
  console.error('   必須: GITHUB_TOKEN, TOGGL_API_TOKEN, GITHUB_REPOSITORIES');
  process.exit(1);
}

// 期間の設定
const end = new Date();
const start = new Date();
start.setDate(start.getDate() - days);

console.log('\n📊 DataIntegrator 手動確認');
console.log('='.repeat(60));
console.log(`📅 期間: ${start.toISOString().split('T')[0]} ~ ${end.toISOString().split('T')[0]} (${days}日間)`);
console.log(`📁 リポジトリ: ${repositories}`);
console.log(`🔍 モード: ${showDetail ? 'diff付き詳細' : 'サマリーのみ'}`);
if (workspaceId) {
  console.log(`🕐 Toggl Workspace ID: ${workspaceId}`);
}
console.log('='.repeat(60));

// クライアントの初期化
const githubClient = new GitHubClient({ token: githubToken });
const togglClient = new TogglClient({ apiToken: togglApiToken });
const integrator = new DataIntegrator(githubClient, togglClient);

// データ収集の実行
console.log('\n🔄 データ収集中...\n');

const repoList = repositories.split(',').map((r) => r.trim());

const result = await integrator.collectAndIntegrate(
  { start, end },
  {
    repositories: repoList,
    workspaceId: workspaceId ? parseInt(workspaceId, 10) : undefined,
  }
);

if (!result.success) {
  console.error('❌ 全データソースの取得に失敗しました:');
  for (const error of result.error.errors) {
    console.error(`   - ${error.source}: ${error.message}`);
  }
  process.exit(1);
}

const data = result.value;

// 警告の表示
if (data.warnings.length > 0) {
  console.log('⚠️  警告:');
  for (const warning of data.warnings) {
    console.log(`   - ${warning.message}`);
  }
  console.log('');
}

// コミット情報の表示
console.log(`📝 コミット数: ${data.commits.length}`);
if (data.commits.length > 0) {
  console.log('─'.repeat(60));
  for (const commit of data.commits.slice(0, 20)) {
    const date = commit.authorDate.toISOString().split('T')[0];
    const msg = commit.message.split('\n')[0].slice(0, 60);
    console.log(`   ${date} [${commit.repository}] ${msg}`);
  }
  if (data.commits.length > 20) {
    console.log(`   ... 他 ${data.commits.length - 20} 件`);
  }
}

// --detail: 各コミットのファイル変更とdiffを表示
if (showDetail && data.commits.length > 0) {
  console.log('\n📄 コミット詳細（diff付き）');
  console.log('='.repeat(60));

  for (const commit of data.commits) {
    const detailResult = await githubClient.getCommitDetail(commit.repository, commit.sha);

    if (!detailResult.success) {
      console.log(`\n❌ ${commit.sha.slice(0, 7)}: 詳細取得失敗 (${detailResult.error.type})`);
      continue;
    }

    const detail = detailResult.value;
    const date = commit.authorDate.toISOString().split('T')[0];
    const msg = detail.message.split('\n')[0];

    console.log(`\n${'━'.repeat(60)}`);
    console.log(`📌 ${commit.sha.slice(0, 7)} ${date} [${commit.repository}]`);
    console.log(`   ${msg}`);
    console.log(`   +${detail.stats.additions} -${detail.stats.deletions} (${detail.stats.filesChanged} files)`);

    for (const file of detail.files) {
      console.log(`\n   📁 ${file.status} ${file.filename} (+${file.additions} -${file.deletions})`);
      if (file.patch) {
        const lines = file.patch.split('\n');
        for (const line of lines) {
          console.log(`   ${line}`);
        }
      }
    }
  }
}

// タイムエントリ情報の表示
console.log(`\n🕐 タイムエントリ数: ${data.timeEntries.length}`);
if (data.timeEntries.length > 0) {
  console.log('─'.repeat(60));
  const totalHours = data.timeEntries.reduce((sum, e) => sum + e.durationSeconds, 0) / 3600;
  console.log(`   合計作業時間: ${totalHours.toFixed(1)} 時間`);
  for (const entry of data.timeEntries.slice(0, 20)) {
    const date = entry.startTime.toISOString().split('T')[0];
    const hours = (entry.durationSeconds / 3600).toFixed(1);
    console.log(`   ${date} [${entry.projectName}] ${entry.description || '(説明なし)'} (${hours}h)`);
  }
  if (data.timeEntries.length > 20) {
    console.log(`   ... 他 ${data.timeEntries.length - 20} 件`);
  }
}

// 日別サマリー
console.log(`\n📅 日別サマリー: ${data.dailySummaries.length} 日`);
if (data.dailySummaries.length > 0) {
  console.log('─'.repeat(60));
  for (const day of data.dailySummaries) {
    const date = day.date.toISOString().split('T')[0];
    console.log(`   ${date}: コミット ${day.commitCount}件, 作業 ${day.workHours.toFixed(1)}h, プロジェクト [${day.projects.join(', ')}]`);
  }
}

// プロジェクト別サマリー
console.log(`\n📁 プロジェクト別サマリー: ${data.projectSummaries.length} 件`);
if (data.projectSummaries.length > 0) {
  console.log('─'.repeat(60));
  for (const project of data.projectSummaries) {
    console.log(`   ${project.projectName}: コミット ${project.totalCommits}件, 作業 ${project.totalWorkHours.toFixed(1)}h`);
  }
}

console.log('\n' + '='.repeat(60));
console.log('✅ 完了\n');
