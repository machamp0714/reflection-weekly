# reflection-weekly

GitHub の Pull Request と Toggl の作業時間データを収集し、OpenAI で分析・要約して Notion に週次振り返りページを自動生成する CLI ツール。

## 機能

- GitHub PR 情報（タイトル、説明文、リポジトリ別集計）の自動収集
- Toggl 作業時間データ（プロジェクト別、日別）の自動収集
- OpenAI による活動サマリーと KPT（Keep/Problem/Try）提案の自動生成
- Notion データベースへの週次振り返りページ自動作成
- 前週の Try 項目の参照機能
- ドライランモード（Notion に書き込まずプレビュー）
- 定期実行スケジュール（macOS launchd / Linux systemd / cron）

## 前提条件

- Node.js >= 20.0.0
- 各サービスの API トークン（GitHub, Toggl, OpenAI, Notion）

## セットアップ

```bash
# リポジトリのクローン
git clone https://github.com/machamp0714/reflection-weekly.git
cd reflection-weekly

# 依存パッケージのインストール
npm install

# 環境変数の設定
cp .env.example .env
# .env を編集して各 API トークンを設定
```

### 環境変数

`.env` ファイルに以下の値を設定してください。

**必須:**

| 変数名 | 説明 | 例 |
|--------|------|----|
| `GITHUB_TOKEN` | GitHub Personal Access Token | `ghp_xxxx` |
| `GITHUB_REPOSITORIES` | 対象リポジトリ（カンマ区切り） | `owner/repo1,owner/repo2` |
| `TOGGL_API_TOKEN` | Toggl Track API トークン | |
| `TOGGL_WORKSPACE_ID` | Toggl ワークスペース ID | `1234567` |
| `NOTION_TOKEN` | Notion インテグレーショントークン | `secret_xxxx` |
| `NOTION_DATABASE_ID` | 振り返りページの保存先データベース ID | |
| `OPENAI_API_KEY` | OpenAI API キー | `sk-xxxx` |

**オプション:**

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `GITHUB_USERNAME` | GitHub ユーザー名 | |
| `OPENAI_MODEL` | 使用する OpenAI モデル | `gpt-4o` |
| `REFLECTION_DEFAULT_PERIOD_DAYS` | 振り返り対象期間（日数） | `7` |
| `SCHEDULE_CRON` | 定期実行の cron 式 | `0 19 * * 0`（毎週日曜 19:00） |
| `SCHEDULE_TIMEZONE` | タイムゾーン | `Asia/Tokyo` |
| `SCHEDULE_ENABLED` | スケジュール実行の有効化 | `false` |
| `SCHEDULE_NOTIFICATION_URL` | 失敗時の Webhook 通知先 URL | |
| `LOG_FILE_PATH` | ログファイルのパス | `~/.reflection-weekly/logs/execution.log` |
| `LOG_LEVEL` | ログレベル (`debug`/`info`/`warn`/`error`) | `info` |
| `LOG_MAX_FILES` | ログファイルの最大保持数 | `10` |
| `LOG_MAX_SIZE` | ログファイルの最大サイズ | `10MB` |

### API 疎通確認

設定が正しいか確認するには、接続チェックスクリプトを実行します。

```bash
npm run check
```

## 使い方

### 基本的な使い方

```bash
# 過去 7 日間の振り返りを生成（デフォルト）
npx tsx src/cli/main.ts

# ビルド後に実行
npm run build
npm start
```

### コマンドオプション

```bash
# 期間を指定して実行
npx tsx src/cli/main.ts --start 2026-01-27 --end 2026-02-02

# ドライランモード（Notion に書き込まずプレビュー）
npx tsx src/cli/main.ts --dry-run

# 詳細出力モード
npx tsx src/cli/main.ts --verbose

# オプションの組み合わせ
npx tsx src/cli/main.ts -s 2026-01-27 -e 2026-02-02 -d -v
```

| オプション | 短縮形 | 説明 |
|-----------|--------|------|
| `--start <date>` | `-s` | 開始日（YYYY-MM-DD） |
| `--end <date>` | `-e` | 終了日（YYYY-MM-DD） |
| `--dry-run` | `-d` | Notion に書き込まずプレビューのみ |
| `--verbose` | `-v` | 詳細な進捗表示 |

## 開発

### npm スクリプト

```bash
npm run build          # TypeScript コンパイル
npm run dev            # ウォッチモードでコンパイル
npm test               # テスト実行
npm run test:watch     # ウォッチモードでテスト
npm run test:coverage  # カバレッジレポート付きテスト
npm run lint           # Lint チェック
npm run lint:fix       # Lint 自動修正
npm run format         # コードフォーマット
npm run typecheck      # 型チェック
```

### プロジェクト構成

```
src/
├── cli/                 # CLI エントリーポイント・引数解析
├── application/         # ユースケース層（処理フロー制御）
├── domain/              # ドメイン層（ビジネスロジック）
│   ├── data-integrator.ts       # GitHub + Toggl データ統合
│   ├── activity-analyzer.ts     # AI による活動分析
│   └── reflection-page-builder.ts # Notion ページ構築
├── infrastructure/      # インフラ層（外部 API 連携）
│   ├── clients/         # API クライアント (GitHub, Toggl, OpenAI, Notion)
│   ├── config/          # 設定管理 (環境変数, cosmiconfig)
│   ├── logger/          # ファイルロガー (pino)
│   └── schedule/        # スケジュール管理・実行管理
├── presentation/        # コマンドハンドラー
├── types/               # 共有型定義
├── integration/         # 統合テスト
└── e2e/                 # E2E テスト
```

### テスト

テストは Vitest で実行します。359 件のテストで構成されています。

```bash
# 全テスト実行
npm test

# 特定のテストファイルを実行
npx vitest run src/cli/cli.test.ts

# カバレッジ付き
npm run test:coverage
```

## ライセンス

ISC
