# Research & Design Decisions

---
**Purpose**: 週次振り返りシステムのディスカバリーフェーズで得られた調査結果と設計判断の根拠を記録する。

**Usage**:
- 外部API仕様の調査結果
- アーキテクチャパターンの比較検討
- 技術選定の根拠
---

## Summary
- **Feature**: `weekly-reflection-system`
- **Discovery Scope**: New Feature（新規フィーチャー / 複合外部API統合）
- **Key Findings**:
  - GitHub API: 認証済みリクエストで5,000リクエスト/時間のレート制限、`since`/`until`パラメータで日付フィルタリング可能
  - Toggl API v9: Basic認証またはAPIトークン、`start_date`/`end_date`パラメータで期間指定可能
  - Notion API: Bearer Token認証、3リクエスト/秒のレート制限、ブロックベースのコンテンツ構造
  - OpenAI API: gpt-4oモデル利用可能、トークン管理とエラーハンドリングが重要
  - スケジュール実行: node-cronでcron式バリデーション、OS標準スケジューラ（launchd/systemd/cron）との連携

## Research Log

### GitHub REST API コミット取得
- **Context**: 要件1.1-1.5で指定されたGitHubコミット履歴取得機能の実装仕様調査
- **Sources Consulted**:
  - [GitHub REST API documentation](https://docs.github.com/en/rest)
  - [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- **Findings**:
  - エンドポイント: `GET /repos/{owner}/{repo}/commits`
  - 認証: Personal Access Token（PAT）推奨、Fine-grained tokenサポート
  - レート制限:
    - 未認証: 60リクエスト/時間
    - PAT認証: 5,000リクエスト/時間
    - GitHub App: 15,000リクエスト/時間（Enterprise Cloud）
  - フィルタリングパラメータ:
    - `since`: ISO 8601タイムスタンプ（開始日時）
    - `until`: ISO 8601タイムスタンプ（終了日時）
    - `author`: コミット作成者でフィルタ
    - `per_page`: ページあたり結果数（最大100、デフォルト30）
  - レスポンス構造: `sha`, `commit.message`, `commit.author.date`, `html_url`, `stats`
- **Implications**:
  - 複数リポジトリ対応には各リポジトリへの個別リクエストが必要
  - ページネーション対応必須（7日間で多数コミットの場合）

### Toggl Track API v9 時間エントリ取得
- **Context**: 要件2.1-2.5で指定されたToggl打刻データ取得機能の実装仕様調査
- **Sources Consulted**:
  - [Toggl Engineering API Docs - Time entries](https://engineering.toggl.com/docs/api/time_entries/)
  - [Toggl Track API v9 announcement](https://toggl.com/blog/toggl-track-api-v9)
- **Findings**:
  - エンドポイント: `GET https://api.track.toggl.com/api/v9/me/time_entries`
  - 認証: Basic認証（email:password または email:api_token）
  - クエリパラメータ:
    - `start_date`: YYYY-MM-DD形式またはRFC3339タイムスタンプ
    - `end_date`: YYYY-MM-DD形式またはRFC3339タイムスタンプ
  - レスポンスフィールド:
    - `id`: タイムエントリID
    - `start`/`stop`: UTC開始・終了時刻
    - `duration`: 秒単位の作業時間（実行中は負の値）
    - `description`: タスク説明
    - `project_id`: プロジェクトID
    - `workspace_id`: ワークスペースID
    - `tags`: タグ配列
  - プロジェクト名取得には追加API呼び出しが必要（`GET /workspaces/{workspace_id}/projects`）
- **Implications**:
  - プロジェクト名のキャッシュまたは事前取得が効率的
  - 作業時間集計はクライアント側で実装

### Notion API ページ作成
- **Context**: 要件4.1-4.6、5.1-5.5で指定されたNotionページ自動生成機能の実装仕様調査
- **Sources Consulted**:
  - [Notion API - Create a page](https://developers.notion.com/reference/post-page)
  - [Start building with the Notion API](https://developers.notion.com/docs/working-with-page-content)
- **Findings**:
  - エンドポイント: `POST https://api.notion.com/v1/pages`
  - 認証: Bearer Token（Integration Token）
  - 必須ヘッダー: `Notion-Version: 2025-09-03`
  - レート制限: 3リクエスト/秒
  - リクエスト構造:
    - `parent`: `{ "database_id": "..." }` でデータベース内にページ作成
    - `properties`: データベーススキーマに合致するプロパティ
    - `children`: ブロック配列でページコンテンツ定義
  - ブロックタイプ: heading_1/2/3, paragraph, bulleted_list_item, numbered_list_item, toggle, divider等
  - 制限事項: テンプレート適用時は`children`パラメータ使用不可
- **Implications**:
  - KPTセクション（Keep/Problem/Try）は見出しブロック+リストブロックで構築
  - 作成後のページURLは`url`フィールドで取得可能

### OpenAI API Chat Completions
- **Context**: 要件3.2-3.6、5.5で指定されたChatGPT連携機能の実装仕様調査
- **Sources Consulted**:
  - [OpenAI API - Chat Completions](https://platform.openai.com/docs/api-reference/chat)
  - [OpenAI Models](https://platform.openai.com/docs/models)
- **Findings**:
  - エンドポイント: `POST https://api.openai.com/v1/chat/completions`
  - 認証: Bearer Token（API Key）
  - 推奨モデル: gpt-4o（高性能・コスト効率のバランス）
  - リクエスト構造:
    - `model`: モデルID
    - `messages`: システム/ユーザーメッセージ配列
    - `temperature`: 0.2-0.8（低いほど決定的）
    - `max_tokens`: 最大出力トークン数
  - ベストプラクティス:
    - トークン管理: プロンプト+完了がトークン制限内に収まるよう管理
    - エラーハンドリング: レート制限、タイムアウト、コンテンツポリシー対応
    - モデルバージョン固定: 一貫した出力のため固定バージョン使用推奨
- **Implications**:
  - サマリー生成と KPT提案を別プロンプトで処理することで品質向上
  - API障害時のフォールバック処理（AI分析なしの基本サマリー）必須

### CLIフレームワーク選定
- **Context**: 要件8.1-8.5で指定されたCLIインターフェース実装のフレームワーク調査
- **Sources Consulted**:
  - [commander vs oclif vs yargs comparison](https://npm-compare.com/commander,oclif,vorpal,yargs)
  - [Crafting Robust Node.js CLIs with oclif and Commander.js](https://leapcell.io/blog/crafting-robust-node-js-clis-with-oclif-and-commander-js)
- **Findings**:
  - **Commander.js**: 軽量、学習コスト低、シンプルなCLIに最適
  - **Yargs**: 強力な引数パース、複雑なコマンド管理
  - **oclif**: エンタープライズ向け、プラグインアーキテクチャ
- **Implications**: 本プロジェクトはシンプルなCLI（単一メインコマンド+オプション）のため、Commander.jsが最適

### Node.js スケジューラライブラリ選定
- **Context**: 要件9.1-9.7で指定されたスケジュール実行機能の実装仕様調査
- **Sources Consulted**:
  - [node-cron - npm](https://www.npmjs.com/package/node-cron)
  - [node-schedule - npm](https://www.npmjs.com/package/node-schedule)
  - [Node.js Job Scheduler Code Example in 2025](https://forwardemail.net/en/blog/docs/node-js-job-scheduler-cron)
- **Findings**:
  - **node-cron**: 軽量、crontab互換構文、外部依存なし、バックグラウンド実行可能
  - **node-schedule**: 柔軟なスケジュール設定、Date指定可能、cron非互換オプションあり
  - **Bree/Agenda**: 永続化対応、アプリケーション再起動後も継続
- **Implications**:
  - cron式バリデーションにnode-cronを使用
  - 実際のスケジュール実行はOS標準スケジューラ（launchd/systemd/cron）に委譲
  - CLIツールのため、アプリケーション常駐型スケジューラは不適切

### macOS launchd スケジュール設定
- **Context**: 要件9.7で指定されたmacOSでのスケジュール登録手順の調査
- **Sources Consulted**:
  - [Apple Developer - Scheduling Timed Jobs](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html)
  - [How to run a task on a schedule on macOS](https://alexwlchan.net/til/2025/macos-launchagent-examples/)
  - [Schedule jobs in MacOSX - launchd guide](https://killtheyak.com/schedule-jobs-launchd/)
- **Findings**:
  - 設定ファイル: `~/Library/LaunchAgents/`に`.plist`ファイルを配置
  - スケジュール設定: `StartCalendarInterval`キーで曜日・時刻を指定
  - コマンド:
    - 登録: `launchctl load ~/Library/LaunchAgents/com.reflection-weekly.plist`
    - 解除: `launchctl unload ~/Library/LaunchAgents/com.reflection-weekly.plist`
  - 利点: Macがスリープ中でもジョブをキューに保持し、起動時に実行
  - plist構造例:
    ```xml
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
        <key>Label</key>
        <string>com.reflection-weekly</string>
        <key>ProgramArguments</key>
        <array>
            <string>/usr/local/bin/node</string>
            <string>/path/to/reflection-weekly/dist/cli.js</string>
            <string>run</string>
        </array>
        <key>StartCalendarInterval</key>
        <dict>
            <key>Weekday</key>
            <integer>0</integer>
            <key>Hour</key>
            <integer>19</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>
        <key>StandardOutPath</key>
        <string>/path/to/logs/reflection-weekly.log</string>
        <key>StandardErrorPath</key>
        <string>/path/to/logs/reflection-weekly.error.log</string>
    </dict>
    </plist>
    ```
- **Implications**: plist生成機能をScheduleManagerに実装、ユーザーへのインストール手順を提供

### Linux systemd タイマー設定
- **Context**: 要件9.7で指定されたLinuxでのスケジュール登録手順の調査
- **Sources Consulted**:
  - [How to schedule tasks with systemd timers in Linux](https://linuxconfig.org/how-to-schedule-tasks-with-systemd-timers-in-linux)
  - [systemd/Timers - ArchWiki](https://wiki.archlinux.org/title/Systemd/Timers)
  - [Working with systemd Timers - SUSE](https://documentation.suse.com/smart/systems-management/html/systemd-working-with-timers/index.html)
- **Findings**:
  - 2つのユニットファイルが必要:
    1. `.timer`ファイル: スケジュール定義
    2. `.service`ファイル: 実行コマンド定義
  - 配置先: ユーザー単位は`~/.config/systemd/user/`
  - コマンド:
    - 有効化: `systemctl --user enable --now reflection-weekly.timer`
    - 無効化: `systemctl --user disable --now reflection-weekly.timer`
    - 状態確認: `systemctl --user status reflection-weekly.timer`
  - タイマーファイル例:
    ```ini
    [Unit]
    Description=Weekly Reflection Generator Timer

    [Timer]
    OnCalendar=Sun 19:00
    Persistent=true

    [Install]
    WantedBy=timers.target
    ```
  - サービスファイル例:
    ```ini
    [Unit]
    Description=Weekly Reflection Generator

    [Service]
    Type=oneshot
    ExecStart=/usr/bin/node /path/to/reflection-weekly/dist/cli.js run
    StandardOutput=append:/path/to/logs/reflection-weekly.log
    StandardError=append:/path/to/logs/reflection-weekly.error.log
    ```
- **Implications**: systemd timer/service生成機能をScheduleManagerに実装

### Linux cron 設定
- **Context**: 要件9.7で指定されたLinux cronでのスケジュール登録手順の調査
- **Findings**:
  - crontab編集: `crontab -e`
  - cron式: `0 19 * * 0 /usr/bin/node /path/to/reflection-weekly/dist/cli.js run >> /path/to/logs/reflection-weekly.log 2>&1`
  - 登録確認: `crontab -l`
- **Implications**: シンプルな代替手段としてcrontabエントリ生成をサポート

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Clean Architecture | ドメイン/アプリケーション/インフラの3層分離 | テスタビリティ、依存関係の明確化、外部サービス切り替え容易 | 初期設計コスト、小規模プロジェクトではオーバーヘッド | 複数外部API統合に適合 |
| Simple Layered | 単純なサービス層+リポジトリ層 | 実装速度、理解しやすい | テスト困難、依存関係の密結合 | 拡張性が低い |
| Hexagonal | Ports & Adapters による完全分離 | 最大の柔軟性、完全なテスト分離 | 過度な抽象化、実装コスト高 | 本プロジェクトには過剰 |

**選定**: Clean Architecture（軽量版）
- 理由: 4つの外部API（GitHub, Toggl, OpenAI, Notion）を統合するため、各APIクライアントをインフラ層に分離し、ドメインロジックとの疎結合を実現

## Design Decisions

### Decision: TypeScript + Node.js ランタイム
- **Context**: CLIツールの実装言語とランタイム選定
- **Alternatives Considered**:
  1. Python - 豊富なライブラリ、クイック開発
  2. Go - シングルバイナリ配布、高速実行
  3. TypeScript/Node.js - 型安全、エコシステム充実
- **Selected Approach**: TypeScript + Node.js
- **Rationale**:
  - 厳密な型定義による堅牢性
  - npm エコシステムの豊富なAPI クライアントライブラリ
  - async/await によるAPI並列処理の容易さ
- **Trade-offs**:
  - 実行速度はGoより遅い（許容範囲）
  - Node.jsランタイム依存
- **Follow-up**: Node.js v20 LTS以上を推奨

### Decision: 設定管理アプローチ
- **Context**: 要件7.1-7.8で指定された柔軟な設定管理の実現方法
- **Alternatives Considered**:
  1. 環境変数のみ - シンプル、12-factor app準拠
  2. 設定ファイルのみ - 複雑な設定管理可能
  3. 環境変数 + 設定ファイル（ハイブリッド） - 機密情報と設定の分離
- **Selected Approach**: ハイブリッド（環境変数優先、設定ファイル補完）
- **Rationale**:
  - APIトークン等の機密情報は環境変数で管理（セキュリティ）
  - リポジトリリスト等の設定は設定ファイルで管理（利便性）
  - 環境変数が設定ファイルを上書き（優先度明確）
- **Trade-offs**:
  - 2つの設定ソースの管理複雑性
  - ユーザーへの説明コスト
- **Follow-up**: dotenvライブラリで.envファイルサポート

### Decision: エラーハンドリング戦略
- **Context**: 複数外部APIへの依存によるエラーハンドリング設計
- **Alternatives Considered**:
  1. Fail-fast - 最初のエラーで停止
  2. Graceful degradation - 部分的失敗を許容し継続
  3. 完全リトライ - すべてのエラーでリトライ
- **Selected Approach**: Graceful degradation + 選択的リトライ
- **Rationale**:
  - 要件3.6, 3.7に明示: API障害時も代替処理で続行
  - ユーザー体験: 部分的でも結果を提供
- **Trade-offs**:
  - 不完全な結果を返す可能性
  - エラー状態の追跡複雑性
- **Follow-up**: 各APIに3回リトライ（指数バックオフ）を実装

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| GitHub APIレート制限超過 | 高 | 低 | 認証必須、リクエスト最適化、レート制限ヘッダー監視 |
| Notion APIレート制限（3req/s） | 中 | 中 | リクエストキュー、バックオフ実装 |
| OpenAI API障害 | 中 | 低 | AI分析なしのフォールバック処理 |
| 長期間データでのパフォーマンス低下 | 中 | 中 | ページネーション、ストリーミング処理 |
| APIスキーマ変更 | 高 | 低 | 明示的なバージョン指定、型定義による早期検出 |
| プラットフォーム固有スケジューラの差異 | 中 | 中 | 各プラットフォーム用の設定生成と詳細手順提供 |
| スケジュール実行時のサイレント失敗 | 高 | 中 | ファイルログ出力必須、オプション通知機能 |
| スケジューラ権限不足 | 中 | 低 | エラーメッセージで必要な権限と手順を案内 |

## References

- [GitHub REST API documentation](https://docs.github.com/en/rest) - コミット取得API仕様
- [GitHub Rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) - レート制限詳細
- [Toggl Track API v9 - Time entries](https://engineering.toggl.com/docs/api/time_entries/) - 時間エントリAPI仕様
- [Notion API - Create a page](https://developers.notion.com/reference/post-page) - ページ作成API仕様
- [OpenAI API - Chat Completions](https://platform.openai.com/docs/api-reference/chat) - Chat Completions API仕様
- [Commander.js](https://github.com/tj/commander.js) - CLIフレームワーク
- [node-cron - npm](https://www.npmjs.com/package/node-cron) - cron互換スケジューラ
- [Apple Developer - Scheduling Timed Jobs](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html) - macOS launchdドキュメント
- [systemd/Timers - ArchWiki](https://wiki.archlinux.org/title/Systemd/Timers) - Linux systemdタイマードキュメント
