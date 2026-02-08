import axios, { AxiosInstance, isAxiosError } from 'axios';
import { Result, ok, err } from '../../types/result.js';

/**
 * KPT suggestions structure
 */
export interface KPTSuggestions {
  readonly keep: readonly string[];
  readonly problem: readonly string[];
  readonly tryItems: readonly string[];
}

/**
 * Summary input data
 */
export interface SummaryInput {
  readonly pullRequests: readonly {
    readonly title: string;
    readonly repository: string;
    readonly date: string;
  }[];
  readonly timeEntries: readonly {
    readonly description: string;
    readonly projectName: string;
    readonly durationHours: number;
  }[];
  readonly period: {
    readonly start: string;
    readonly end: string;
  };
}

/**
 * KPT input data
 */
export interface KPTInput {
  readonly weekSummary: string;
  readonly highlights: readonly string[];
  readonly previousTryItems?: readonly string[];
}

/**
 * OpenAI error types
 */
export type OpenAIError =
  | { readonly type: 'UNAUTHORIZED'; readonly message: string }
  | { readonly type: 'RATE_LIMITED'; readonly retryAfter: number }
  | { readonly type: 'CONTENT_FILTERED'; readonly message: string }
  | { readonly type: 'TOKEN_LIMIT_EXCEEDED'; readonly message: string }
  | { readonly type: 'SERVICE_UNAVAILABLE'; readonly message: string };

/**
 * OpenAI client configuration
 */
export interface OpenAIClientConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly baseUrl?: string;
}

/**
 * Chat completion request
 */
interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

/**
 * Chat message
 */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Chat completion response
 */
interface ChatCompletionResponse {
  id: string;
  choices: {
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * OpenAI Chat Completions API Client
 */
export class OpenAIClient {
  private readonly client: AxiosInstance;
  private readonly model: string;
  private readonly maxRetries = 3;
  private readonly retryDelayMs = 1000;

  constructor(config: OpenAIClientConfig) {
    this.model = config.model || 'gpt-4o';

    this.client = axios.create({
      baseURL: config.baseUrl || 'https://api.openai.com/v1',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000, // 60 seconds for AI responses
    });
  }

  /**
   * Generate activity summary from pull requests and time entries
   */
  async generateSummary(data: SummaryInput): Promise<Result<string, OpenAIError>> {
    const systemPrompt = `あなたは週次振り返りアシスタントです。
GitHubのPull Request履歴とTogglの作業時間データを分析し、
開発者の1週間の活動を簡潔に要約してください。
日本語で回答してください。`;

    const userPrompt = this.buildSummaryPrompt(data);

    try {
      const response = await this.executeWithRetry(() =>
        this.client.post<ChatCompletionResponse>('/chat/completions', {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 1000,
        } as ChatCompletionRequest)
      );

      const content = response.data.choices[0]?.message?.content;
      if (!content) {
        return err({
          type: 'SERVICE_UNAVAILABLE',
          message: 'Empty response from OpenAI',
        });
      }

      return ok(content.trim());
    } catch (error) {
      return this.handleError(error);
    }
  }

  /**
   * Generate KPT suggestions based on activity data
   */
  async generateKPTSuggestions(data: KPTInput): Promise<Result<KPTSuggestions, OpenAIError>> {
    const systemPrompt = `あなたは週次振り返りアシスタントです。
開発者の週次活動サマリーを基に、KPT（Keep/Problem/Try）形式で
振り返りの提案を生成してください。
以下のJSON形式で回答してください:
{
  "keep": ["継続すべきこと1", "継続すべきこと2"],
  "problem": ["問題点1", "問題点2"],
  "try": ["次週挑戦すること1", "次週挑戦すること2"]
}
各項目は2-4個程度にしてください。`;

    const userPrompt = this.buildKPTPrompt(data);

    try {
      const response = await this.executeWithRetry(() =>
        this.client.post<ChatCompletionResponse>('/chat/completions', {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.5,
          max_tokens: 800,
        } as ChatCompletionRequest)
      );

      const content = response.data.choices[0]?.message?.content;
      if (!content) {
        return err({
          type: 'SERVICE_UNAVAILABLE',
          message: 'Empty response from OpenAI',
        });
      }

      return this.parseKPTResponse(content);
    } catch (error) {
      return this.handleError(error);
    }
  }

  private buildSummaryPrompt(data: SummaryInput): string {
    let prompt = `## 期間: ${data.period.start} - ${data.period.end}\n\n`;

    if (data.pullRequests.length > 0) {
      prompt += '## Pull Request\n';
      const groupedPRs = this.groupByRepository(data.pullRequests);
      for (const [repo, prs] of Object.entries(groupedPRs)) {
        prompt += `### ${repo}\n`;
        prs.forEach((pr) => {
          prompt += `- ${pr.title} (${pr.date})\n`;
        });
      }
      prompt += '\n';
    } else {
      prompt += '## Pull Request\nこの期間のPull Requestはありません。\n\n';
    }

    if (data.timeEntries.length > 0) {
      prompt += '## 作業時間\n';
      const groupedEntries = this.groupByProject(data.timeEntries);
      for (const [project, entries] of Object.entries(groupedEntries)) {
        const totalHours = entries.reduce((sum, e) => sum + e.durationHours, 0);
        prompt += `### ${project}: ${totalHours.toFixed(1)}時間\n`;
        entries.forEach((e) => {
          if (e.description) {
            prompt += `- ${e.description}: ${e.durationHours.toFixed(1)}時間\n`;
          }
        });
      }
    } else {
      prompt += '## 作業時間\nこの期間の作業時間記録はありません。\n';
    }

    prompt += '\n上記のデータを基に、この1週間の活動を200-300字程度で要約してください。';

    return prompt;
  }

  private buildKPTPrompt(data: KPTInput): string {
    let prompt = `## 週次活動サマリー\n${data.weekSummary}\n\n`;

    if (data.highlights.length > 0) {
      prompt += '## ハイライト\n';
      data.highlights.forEach((h) => {
        prompt += `- ${h}\n`;
      });
      prompt += '\n';
    }

    if (data.previousTryItems && data.previousTryItems.length > 0) {
      prompt += '## 前週のTry項目\n';
      data.previousTryItems.forEach((t) => {
        prompt += `- ${t}\n`;
      });
      prompt += '\n';
    }

    prompt += '上記を基に、KPT形式で振り返りの提案をJSON形式で生成してください。';

    return prompt;
  }

  private groupByRepository(
    pullRequests: readonly { title: string; repository: string; date: string }[]
  ): Record<string, { title: string; repository: string; date: string }[]> {
    const grouped: Record<string, { title: string; repository: string; date: string }[]> = {};
    for (const pr of pullRequests) {
      if (!grouped[pr.repository]) {
        grouped[pr.repository] = [];
      }
      grouped[pr.repository].push(pr);
    }
    return grouped;
  }

  private groupByProject(
    entries: readonly { description: string; projectName: string; durationHours: number }[]
  ): Record<string, { description: string; projectName: string; durationHours: number }[]> {
    const grouped: Record<
      string,
      { description: string; projectName: string; durationHours: number }[]
    > = {};
    for (const entry of entries) {
      const key = entry.projectName || 'その他';
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(entry);
    }
    return grouped;
  }

  private parseKPTResponse(content: string): Result<KPTSuggestions, OpenAIError> {
    try {
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.getDefaultKPT();
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        keep?: string[];
        problem?: string[];
        try?: string[];
      };

      return ok({
        keep: parsed.keep || [],
        problem: parsed.problem || [],
        tryItems: parsed.try || [],
      });
    } catch {
      return this.getDefaultKPT();
    }
  }

  private getDefaultKPT(): Result<KPTSuggestions, OpenAIError> {
    return ok({
      keep: ['継続的な活動を維持できています'],
      problem: ['分析データが不足しています'],
      tryItems: ['より詳細な活動記録をつけてみましょう'],
    });
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    retryCount = 0
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (retryCount < this.maxRetries && this.isRetryableError(error)) {
        const delay = this.retryDelayMs * Math.pow(2, retryCount);
        await this.sleep(delay);
        return this.executeWithRetry(operation, retryCount + 1);
      }
      throw error;
    }
  }

  private isRetryableError(error: unknown): boolean {
    if (!isAxiosError(error)) {
      return false;
    }

    const status = error.response?.status;
    return (
      status === undefined ||
      status >= 500 ||
      status === 429 ||
      error.code === 'ECONNRESET' ||
      error.code === 'ETIMEDOUT'
    );
  }

  private handleError(error: unknown): Result<never, OpenAIError> {
    if (!isAxiosError(error)) {
      return err({
        type: 'SERVICE_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    const status = error.response?.status;
    const data = error.response?.data as Record<string, unknown> | undefined;
    const errorData = data?.error as Record<string, unknown> | undefined;
    const message = (errorData?.message as string) || error.message;

    switch (status) {
      case 401:
        return err({
          type: 'UNAUTHORIZED',
          message,
        });

      case 429: {
        const retryAfter = parseInt(
          error.response?.headers?.['retry-after'] as string,
          10
        ) || 60;
        return err({
          type: 'RATE_LIMITED',
          retryAfter,
        });
      }

      case 400:
        if (message.includes('content_filter') || message.includes('content_policy')) {
          return err({
            type: 'CONTENT_FILTERED',
            message,
          });
        }
        if (message.includes('token') || message.includes('length')) {
          return err({
            type: 'TOKEN_LIMIT_EXCEEDED',
            message,
          });
        }
        return err({
          type: 'SERVICE_UNAVAILABLE',
          message,
        });

      default:
        return err({
          type: 'SERVICE_UNAVAILABLE',
          message,
        });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
