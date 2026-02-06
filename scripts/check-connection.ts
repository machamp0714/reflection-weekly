#!/usr/bin/env npx tsx
/**
 * 各APIサービスへの疎通確認スクリプト
 * 使用方法: npx tsx scripts/check-connection.ts [service]
 * 例:
 *   npx tsx scripts/check-connection.ts          # 全サービスをチェック
 *   npx tsx scripts/check-connection.ts github   # GitHubのみ
 *   npx tsx scripts/check-connection.ts toggl    # Togglのみ
 *   npx tsx scripts/check-connection.ts notion   # Notionのみ
 *   npx tsx scripts/check-connection.ts openai   # OpenAIのみ
 */

import { config } from 'dotenv';
config();

const services = ['github', 'toggl', 'notion', 'openai'] as const;
type Service = (typeof services)[number];

interface CheckResult {
  service: string;
  success: boolean;
  message: string;
  details?: unknown;
}

async function checkGitHub(): Promise<CheckResult> {
  const token = process.env.GITHUB_TOKEN;
  const repos = process.env.GITHUB_REPOSITORIES;

  if (!token) {
    return { service: 'GitHub', success: false, message: 'GITHUB_TOKEN が設定されていません' };
  }
  if (!repos) {
    return { service: 'GitHub', success: false, message: 'GITHUB_REPOSITORIES が設定されていません' };
  }

  try {
    // ユーザー情報を取得して認証確認
    const response = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        service: 'GitHub',
        success: false,
        message: `認証失敗: ${response.status}`,
        details: error,
      };
    }

    const user = await response.json();

    // 最初のリポジトリへのアクセス確認
    const firstRepo = repos.split(',')[0].trim();
    const repoResponse = await fetch(`https://api.github.com/repos/${firstRepo}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!repoResponse.ok) {
      return {
        service: 'GitHub',
        success: false,
        message: `リポジトリ ${firstRepo} へのアクセス失敗`,
        details: { user: user.login, repo: firstRepo },
      };
    }

    return {
      service: 'GitHub',
      success: true,
      message: `認証成功`,
      details: { user: user.login, repositories: repos },
    };
  } catch (error) {
    return {
      service: 'GitHub',
      success: false,
      message: `接続エラー: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function checkToggl(): Promise<CheckResult> {
  const token = process.env.TOGGL_API_TOKEN;

  if (!token) {
    return { service: 'Toggl', success: false, message: 'TOGGL_API_TOKEN が設定されていません' };
  }

  try {
    const credentials = Buffer.from(`${token}:api_token`).toString('base64');
    const response = await fetch('https://api.track.toggl.com/api/v9/me', {
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    });

    if (!response.ok) {
      return {
        service: 'Toggl',
        success: false,
        message: `認証失敗: ${response.status}`,
      };
    }

    const user = await response.json();
    return {
      service: 'Toggl',
      success: true,
      message: `認証成功`,
      details: { email: user.email, defaultWorkspaceId: user.default_workspace_id },
    };
  } catch (error) {
    return {
      service: 'Toggl',
      success: false,
      message: `接続エラー: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function checkNotion(): Promise<CheckResult> {
  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!token) {
    return { service: 'Notion', success: false, message: 'NOTION_TOKEN が設定されていません' };
  }
  if (!databaseId) {
    return { service: 'Notion', success: false, message: 'NOTION_DATABASE_ID が設定されていません' };
  }

  try {
    // ユーザー情報を取得して認証確認
    const userResponse = await fetch('https://api.notion.com/v1/users/me', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (!userResponse.ok) {
      const error = await userResponse.json();
      return {
        service: 'Notion',
        success: false,
        message: `認証失敗: ${userResponse.status}`,
        details: error,
      };
    }

    const user = await userResponse.json();

    // データベースへのアクセス確認
    const dbResponse = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
    });

    if (!dbResponse.ok) {
      return {
        service: 'Notion',
        success: false,
        message: `データベースへのアクセス失敗 (インテグレーションにデータベースへのアクセス権を付与してください)`,
        details: { botName: user.name || user.bot?.owner?.user?.name, databaseId },
      };
    }

    const db = await dbResponse.json();
    return {
      service: 'Notion',
      success: true,
      message: `認証成功`,
      details: {
        botName: user.name || user.bot?.owner?.user?.name,
        databaseTitle: db.title?.[0]?.plain_text || 'Untitled',
      },
    };
  } catch (error) {
    return {
      service: 'Notion',
      success: false,
      message: `接続エラー: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function checkOpenAI(): Promise<CheckResult> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return { service: 'OpenAI', success: false, message: 'OPENAI_API_KEY が設定されていません' };
  }

  try {
    // モデル一覧を取得して認証確認
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        service: 'OpenAI',
        success: false,
        message: `認証失敗: ${response.status}`,
        details: error,
      };
    }

    const data = await response.json();
    const model = process.env.OPENAI_MODEL || 'gpt-4o';
    const hasModel = data.data?.some((m: { id: string }) => m.id === model);

    return {
      service: 'OpenAI',
      success: true,
      message: `認証成功`,
      details: {
        model,
        modelAvailable: hasModel,
        totalModels: data.data?.length || 0,
      },
    };
  } catch (error) {
    return {
      service: 'OpenAI',
      success: false,
      message: `接続エラー: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function runChecks(targetService?: string): Promise<void> {
  console.log('\n🔍 API疎通確認を開始します...\n');
  console.log('=' .repeat(60));

  const checks: Record<Service, () => Promise<CheckResult>> = {
    github: checkGitHub,
    toggl: checkToggl,
    notion: checkNotion,
    openai: checkOpenAI,
  };

  const servicesToCheck = targetService
    ? [targetService as Service]
    : services;

  const results: CheckResult[] = [];

  for (const service of servicesToCheck) {
    if (!checks[service]) {
      console.log(`\n❓ 不明なサービス: ${service}`);
      continue;
    }

    console.log(`\n🔄 ${service.toUpperCase()} をチェック中...`);
    const result = await checks[service]();
    results.push(result);

    if (result.success) {
      console.log(`✅ ${result.service}: ${result.message}`);
      if (result.details) {
        console.log(`   詳細: ${JSON.stringify(result.details, null, 2).replace(/\n/g, '\n   ')}`);
      }
    } else {
      console.log(`❌ ${result.service}: ${result.message}`);
      if (result.details) {
        console.log(`   詳細: ${JSON.stringify(result.details, null, 2).replace(/\n/g, '\n   ')}`);
      }
    }
  }

  console.log('\n' + '=' .repeat(60));
  console.log('\n📊 結果サマリー:');

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`   ✅ 成功: ${passed}`);
  console.log(`   ❌ 失敗: ${failed}`);

  if (failed > 0) {
    console.log('\n💡 ヒント:');
    for (const result of results.filter(r => !r.success)) {
      switch (result.service) {
        case 'GitHub':
          console.log('   - GitHub: Personal Access Token を作成し、repo スコープを付与してください');
          console.log('     https://github.com/settings/tokens');
          break;
        case 'Toggl':
          console.log('   - Toggl: Profile Settings から API Token を取得してください');
          console.log('     https://track.toggl.com/profile');
          break;
        case 'Notion':
          console.log('   - Notion: Integration を作成し、データベースに接続してください');
          console.log('     https://www.notion.so/my-integrations');
          break;
        case 'OpenAI':
          console.log('   - OpenAI: API Key を作成してください');
          console.log('     https://platform.openai.com/api-keys');
          break;
      }
    }
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

// メイン処理
const targetService = process.argv[2];
runChecks(targetService);
