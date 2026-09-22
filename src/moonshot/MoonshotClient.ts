import { SseParser } from './streamParser';
import type {
	ChatStreamEvent,
	MoonshotChatChunk,
	MoonshotChatRequest,
	MoonshotModelList,
} from './types';
import {
	classifyHttpError,
	MoonshotAbortError,
	MoonshotClientError,
	MoonshotProtocolError,
	MoonshotTimeoutError,
} from '../utils/errors';

export interface MoonshotClientOptions {
	/** Base URL, e.g. `https://api.moonshot.ai/v1`. Trailing slashes are stripped. */
	baseUrl: string;
	/** Overall request timeout (user cancellation always wins). Defaults to 5 minutes. */
	timeoutMs?: number;
	/** Injectable for tests. Defaults to the global `fetch`. */
	fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const ERROR_BODY_LIMIT = 4096;

/**
 * Minimal, dependency-free client for Moonshot AI's OpenAI-compatible API.
 *
 * The API key is accepted per-call and is never stored, logged, or embedded
 * in error messages by this class.
 */
export class MoonshotClient {
	private readonly baseUrl: string;
	private readonly timeoutMs: number;
	private readonly fetchImpl: typeof fetch;

	constructor(options: MoonshotClientOptions) {
		this.baseUrl = options.baseUrl.replace(/\/+$/, '');
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
	}

	/** Hostname used in diagnostics, so users can see which endpoint is contacted. */
	get host(): string {
		try {
			return new URL(this.baseUrl).host;
		} catch {
			return this.baseUrl;
		}
	}

	/**
	 * Lightweight authenticated check: `GET /models`. Validates the key and
	 * connectivity without spending any chat tokens.
	 */
	async testConnection(apiKey: string, signal?: AbortSignal): Promise<{ modelCount: number; host: string }> {
		const response = await this.request(`${this.baseUrl}/models`, { method: 'GET' }, apiKey, signal, 20_000);
		const body = (await response.json()) as MoonshotModelList;
		return { modelCount: Array.isArray(body.data) ? body.data.length : 0, host: this.host };
	}

	/**
	 * Stream a chat completion. Yields normalized {@link ChatStreamEvent}s as
	 * they arrive. Throws {@link MoonshotClientError} subclasses on failure;
	 * aborting `signal` raises {@link MoonshotAbortError}.
	 */
	async *streamChat(
		request: MoonshotChatRequest,
		apiKey: string,
		signal?: AbortSignal,
	): AsyncGenerator<ChatStreamEvent, void, undefined> {
		const response = await this.request(
			`${this.baseUrl}/chat/completions`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
				body: JSON.stringify({ ...request, stream: true }),
			},
			apiKey,
			signal,
			this.timeoutMs,
		);

		if (!response.body) {
			throw new MoonshotProtocolError('The Moonshot API returned a streaming response without a body.');
		}

		const parser = new SseParser();
		const decoder = new TextDecoder();
		const reader = response.body.getReader();

		try {
			for (;;) {
				if (signal?.aborted) {
					throw new MoonshotAbortError();
				}
				const { done, value } = await reader.read();
				if (done) {
					break;
				}
				for (const event of parser.push(decoder.decode(value, { stream: true }))) {
					if (event.kind === 'done') {
						return;
					}
					yield* this.translateChunk(event.json);
				}
			}
			for (const event of parser.flush()) {
				if (event.kind === 'done') {
					return;
				}
				yield* this.translateChunk(event.json);
			}
		} catch (error) {
			if (error instanceof MoonshotClientError) {
				throw error;
			}
			if (signal?.aborted || isAbortError(error)) {
				throw new MoonshotAbortError();
			}
			throw error;
		} finally {
			// Best-effort cleanup; releasing the reader aborts the underlying
			// connection if the stream ended early (e.g. on cancellation).
			reader.releaseLock();
			void response.body.cancel().catch(() => undefined);
		}
	}

	private *translateChunk(json: unknown): Generator<ChatStreamEvent, void, undefined> {
		const chunk = json as Partial<MoonshotChatChunk>;
		if (chunk.usage) {
			yield { type: 'usage', usage: chunk.usage };
		}
		if (!Array.isArray(chunk.choices)) {
			throw new MoonshotProtocolError('Received an unexpected chunk shape from the Moonshot API.');
		}
		for (const choice of chunk.choices) {
			const delta = choice.delta ?? {};
			if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
				yield { type: 'reasoning', text: delta.reasoning_content };
			}
			if (typeof delta.content === 'string' && delta.content.length > 0) {
				yield { type: 'text', text: delta.content };
			}
			if (Array.isArray(delta.tool_calls)) {
				for (const toolCallDelta of delta.tool_calls) {
					yield { type: 'toolCallDelta', delta: toolCallDelta };
				}
			}
			if (choice.finish_reason) {
				yield { type: 'finish', reason: choice.finish_reason };
			}
		}
	}

	private async request(
		url: string,
		init: RequestInit,
		apiKey: string,
		userSignal: AbortSignal | undefined,
		timeoutMs: number,
	): Promise<Response> {
		const timeoutSignal = AbortSignal.timeout(timeoutMs);
		const signals = userSignal ? [userSignal, timeoutSignal] : [timeoutSignal];
		const combined = AbortSignal.any(signals);

		let response: Response;
		try {
			response = await this.fetchImpl(url, {
				...init,
				headers: { ...init.headers, Authorization: `Bearer ${apiKey}` },
				signal: combined,
			});
		} catch (error) {
			if (userSignal?.aborted || (isAbortError(error) && !timeoutSignal.aborted)) {
				throw new MoonshotAbortError();
			}
			if (timeoutSignal.aborted) {
				throw new MoonshotTimeoutError(`The Moonshot API (${this.host}) did not respond within ${Math.round(timeoutMs / 1000)}s.`);
			}
			throw new MoonshotClientError(
				'network',
				`Could not reach the Moonshot API at ${this.host}. Check your network connection and the kimi.apiBaseUrl setting.`,
			);
		}

		if (!response.ok) {
			const bodyText = (await response.text().catch(() => '')).slice(0, ERROR_BODY_LIMIT);
			throw classifyHttpError(response.status, bodyText, response.headers.get('retry-after'));
		}
		return response;
	}
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}
