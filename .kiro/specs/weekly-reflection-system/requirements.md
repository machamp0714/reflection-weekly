# Requirements Document

## Introduction

本ドキュメントは、週次振り返りシステムの要件を定義します。このシステムは、GitHubのPR（Pull Request）データとTogglの打刻データを統合し、Notionに自動的に振り返りページを作成することで、KPT（Keep/Problem/Try）形式の振り返りと自己成長の追跡を支援します。

## Requirements

### Requirement 1: GitHub PRデータ取得

**Objective:** As a ユーザー, I want 1週間分のGitHub PR（Pull Request）データを自動取得したい, so that 振り返りの材料として活動内容をより正確に把握できる

#### Acceptance Criteria

1. When ユーザーが振り返り生成を実行した時, the システム shall 指定された期間（デフォルト: 過去7日間）に作成されたGitHub PRを取得する
2. When PRデータを取得した時, the システム shall PRタイトル、PR説明文（description）、作成日時、リポジトリ名を抽出する
3. When PRデータを取得した時, the システム shall 指定期間内に作成されたPR数を集計する
4. If GitHub APIへの接続に失敗した場合, the システム shall エラーメッセージを表示し、リトライオプションを提供する
5. If 指定期間にPRが存在しない場合, the システム shall 「該当期間のPRはありません」と通知する
6. The システム shall 複数のリポジトリからPRデータを取得できる

### Requirement 2: Toggl打刻データ取得

**Objective:** As a ユーザー, I want 1週間分のToggl打刻データを自動取得したい, so that 振り返りの材料として作業時間を把握できる

#### Acceptance Criteria

1. When ユーザーが振り返り生成を実行した時, the システム shall 指定された期間（デフォルト: 過去7日間）のToggl時間記録を取得する
2. When 打刻データを取得した時, the システム shall プロジェクト名、タスク説明、作業時間、日時を抽出する
3. If Toggl APIへの接続に失敗した場合, the システム shall エラーメッセージを表示し、リトライオプションを提供する
4. If 指定期間に打刻データが存在しない場合, the システム shall 「該当期間の打刻データはありません」と通知する
5. The システム shall 作業時間をプロジェクト別・日別に集計できる

### Requirement 3: データ統合・分析（ChatGPT連携）

**Objective:** As a ユーザー, I want GitHubとTogglのデータを統合してChatGPTで分析したい, so that AIによる洞察を含む活動の全体像を把握できる

#### Acceptance Criteria

1. When GitHubとTogglのデータを取得完了した時, the システム shall 両データを時系列で統合する
2. When データを統合した時, the システム shall ChatGPT（OpenAI API）を使用して日別の活動サマリーを生成する
3. When 活動サマリーを生成する時, the システム shall PR内容と作業時間から主要な成果・活動を自然言語で要約する
4. The システム shall ChatGPTにPR数と作業時間の相関分析を依頼し、洞察を生成する
5. The システム shall プロジェクト別の活動量（PR数、作業時間）を集計する
6. If OpenAI APIへの接続に失敗した場合, the システム shall エラーメッセージを表示し、AI分析なしの基本サマリーを生成する代替処理を行う
7. If いずれかのデータソースが空の場合, the システム shall 利用可能なデータのみで分析を続行する

### Requirement 4: Notionページ自動生成

**Objective:** As a ユーザー, I want Notionに振り返りページを自動生成したい, so that 振り返り内容を一元管理できる

#### Acceptance Criteria

1. When データ分析が完了した時, the システム shall 指定されたNotionデータベースに新規ページを作成する
2. When ページを作成する時, the システム shall 週の開始日と終了日をタイトルに含める
3. When ページを作成する時, the システム shall GitHub PRサマリーセクションを生成する
4. When ページを作成する時, the システム shall Toggl作業時間サマリーセクションを生成する
5. If Notion APIへの接続に失敗した場合, the システム shall エラーメッセージを表示し、ローカルにMarkdownファイルとして出力する代替オプションを提供する
6. The システム shall 作成したNotionページのURLを表示する

### Requirement 5: KPTフレームワーク支援

**Objective:** As a ユーザー, I want KPT形式で振り返りを記録したい, so that 構造化された振り返りができる

#### Acceptance Criteria

1. When Notionページを作成する時, the システム shall Keep（継続すること）セクションを生成する
2. When Notionページを作成する時, the システム shall Problem（問題点）セクションを生成する
3. When Notionページを作成する時, the システム shall Try（次週挑戦すること）セクションを生成する
4. The システム shall 各KPTセクションに入力用のプレースホルダーテキストを配置する
5. Where AI分析機能が有効な場合, the システム shall ChatGPT（OpenAI API）を使用して収集データに基づいたKPTの提案を自動生成する

### Requirement 6: 自己成長追跡

**Objective:** As a ユーザー, I want 週次の振り返りを蓄積して成長を追跡したい, so that 長期的な自己成長を実感できる

#### Acceptance Criteria

1. The システム shall 過去の振り返りページへのリンクをNotionデータベースで管理する
2. When 新しい振り返りページを作成する時, the システム shall 前週のTry項目を参照セクションとして含める
3. Where 複数週の振り返りデータが蓄積された場合, the システム shall 週ごとの活動量推移を確認できるサマリーを提供する
4. The システム shall 振り返りページに週番号とタグを自動付与する
5. If 前週の振り返りページが存在しない場合, the システム shall 参照セクションを空として処理を続行する

### Requirement 7: 設定管理

**Objective:** As a ユーザー, I want システムの設定を柔軟に変更したい, so that 自分のワークフローに合わせてカスタマイズできる

#### Acceptance Criteria

1. The システム shall GitHub API認証情報を設定ファイルまたは環境変数で管理する
2. The システム shall Toggl API認証情報を設定ファイルまたは環境変数で管理する
3. The システム shall Notion API認証情報と対象データベースIDを設定ファイルまたは環境変数で管理する
4. The システム shall OpenAI API認証情報を設定ファイルまたは環境変数で管理する
5. The システム shall ChatGPTのモデル（gpt-4o等）を設定可能にする
6. The システム shall 振り返り対象期間（デフォルト: 7日間）を設定可能にする
7. The システム shall 対象GitHubリポジトリのリストを設定可能にする
8. The システム shall スケジュール実行の曜日・時刻（デフォルト: 日曜日19:00）を設定可能にする
9. The システム shall 実行ログの出力先パスを設定可能にする
10. If 必須の設定が不足している場合, the システム shall 不足している設定項目を明示してエラーを表示する

### Requirement 8: 実行インターフェース

**Objective:** As a ユーザー, I want シンプルなコマンドで振り返りを生成したい, so that 手軽に週次振り返りを実行できる

#### Acceptance Criteria

1. The システム shall CLIコマンドで振り返り生成を実行できる
2. When コマンドを実行する時, the システム shall 処理の進捗状況を表示する
3. The システム shall 期間指定オプション（開始日、終了日）を受け付ける
4. The システム shall ドライランモード（実際にNotionページを作成せずにプレビュー）を提供する
5. When 処理が完了した時, the システム shall 生成結果のサマリーを表示する

### Requirement 9: スケジュール実行（バッチ処理）

**Objective:** As a ユーザー, I want 振り返り生成を定期的に自動実行したい, so that 毎週決まった時間に振り返りページが作成される

#### Acceptance Criteria

1. The システム shall cron互換のスケジュール設定をサポートする
2. The システム shall デフォルトで毎週日曜日19:00に実行するスケジュールを設定可能にする
3. When スケジュール実行時, the システム shall 実行ログをファイルに出力する
4. If スケジュール実行が失敗した場合, the システム shall エラーログを記録し、設定された通知先（オプション）に通知する
5. The システム shall スケジュール登録・解除用のCLIコマンドを提供する
6. When スケジュール実行が完了した時, the システム shall 作成されたNotionページのURLをログに記録する
7. The システム shall macOS launchdまたはLinux systemd/cronでのスケジュール登録手順を提供する
