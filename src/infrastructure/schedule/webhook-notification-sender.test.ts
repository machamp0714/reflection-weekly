import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import {
  WebhookNotificationSender,
  type FailureNotification,
} from './webhook-notification-sender.js';

// axiosをモック
vi.mock('axios');

describe('WebhookNotificationSender', () => {
  let sender: WebhookNotificationSender;

  beforeEach(() => {
    vi.clearAllMocks();
    sender = new WebhookNotificationSender();
  });

  describe('sendFailureNotification', () => {
    it('指定されたURLにPOSTリクエストを送信する', async () => {
      vi.mocked(axios.post).mockResolvedValue({ status: 200, data: 'ok' });

      const notification: FailureNotification = {
        executionId: 'sched-123',
        error: {
          type: 'DATA_COLLECTION_FAILED',
          message: 'GitHub API error',
        },
        timestamp: new Date('2026-02-08T19:00:00+09:00'),
      };

      await sender.sendFailureNotification(
        'https://hooks.slack.com/services/xxx',
        notification,
      );

      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/xxx',
        expect.objectContaining({
          text: expect.stringContaining('DATA_COLLECTION_FAILED'),
        }),
        expect.objectContaining({
          timeout: expect.any(Number),
        }),
      );
    });

    it('通知ペイロードに実行IDとエラー情報が含まれる', async () => {
      vi.mocked(axios.post).mockResolvedValue({ status: 200, data: 'ok' });

      const notification: FailureNotification = {
        executionId: 'sched-456',
        error: {
          type: 'CONFIG_INVALID',
          message: '設定が不正です',
        },
        timestamp: new Date('2026-02-08T19:00:00+09:00'),
      };

      await sender.sendFailureNotification(
        'https://example.com/webhook',
        notification,
      );

      const callArgs = vi.mocked(axios.post).mock.calls[0];
      const payload = callArgs[1] as Record<string, unknown>;
      const text = payload.text as string;

      expect(text).toContain('sched-456');
      expect(text).toContain('CONFIG_INVALID');
      expect(text).toContain('設定が不正です');
    });

    it('HTTPエラー時に例外をスローする', async () => {
      vi.mocked(axios.post).mockRejectedValue(new Error('Network error'));

      const notification: FailureNotification = {
        executionId: 'sched-789',
        error: {
          type: 'UNEXPECTED_ERROR',
          message: 'Unknown error',
        },
        timestamp: new Date(),
      };

      await expect(
        sender.sendFailureNotification('https://example.com/webhook', notification),
      ).rejects.toThrow('Network error');
    });

    it('タイムアウトが設定されている', async () => {
      vi.mocked(axios.post).mockResolvedValue({ status: 200, data: 'ok' });

      const notification: FailureNotification = {
        executionId: 'sched-timeout',
        error: {
          type: 'DATA_COLLECTION_FAILED',
          message: 'Error',
        },
        timestamp: new Date(),
      };

      await sender.sendFailureNotification(
        'https://example.com/webhook',
        notification,
      );

      const callArgs = vi.mocked(axios.post).mock.calls[0];
      const config = callArgs[2] as Record<string, unknown>;

      // タイムアウトは10秒以内
      expect(config.timeout).toBeLessThanOrEqual(10000);
      expect(config.timeout).toBeGreaterThan(0);
    });
  });
});
