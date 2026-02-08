import axios from 'axios';
import type { FailureNotification } from './schedule-execution-manager.js';

// FailureNotificationをre-export（後方互換性のため）
export type { FailureNotification } from './schedule-execution-manager.js';

/**
 * Webhook経由の失敗通知送信
 *
 * Slack互換のWebhook URLにJSON形式で失敗通知を送信する。
 * Requirements: 9.4
 */
export class WebhookNotificationSender {
  private readonly timeout: number;

  constructor(timeout: number = 5000) {
    this.timeout = timeout;
  }

  /**
   * 失敗通知を送信する
   *
   * @param url - Webhook URL
   * @param notification - 失敗通知のペイロード
   * @throws HTTPエラー時に例外をスロー
   */
  async sendFailureNotification(
    url: string,
    notification: FailureNotification,
  ): Promise<void> {
    const text = this.formatNotificationText(notification);

    await axios.post(
      url,
      { text },
      {
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
  }

  /**
   * 通知テキストをフォーマットする
   */
  private formatNotificationText(notification: FailureNotification): string {
    const timestamp = notification.timestamp.toISOString();
    return [
      `[reflection-weekly] スケジュール実行失敗`,
      `実行ID: ${notification.executionId}`,
      `エラータイプ: ${notification.error.type}`,
      `エラー内容: ${notification.error.message}`,
      `発生時刻: ${timestamp}`,
    ].join('\n');
  }
}
