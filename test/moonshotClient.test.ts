import { describe, expect, it, vi } from 'vitest';
import { MoonshotClient } from '../src/moonshot/MoonshotClient';
import type { ChatStreamEvent, MoonshotChatRequest } from '../src/moonshot/types';
import { MoonshotAbortError, MoonshotClientError, MoonshotTimeoutError } from '../src/utils/errors';

const REQUEST: MoonshotChatRequest = {
	model: 'kimi-k3',
	messages: [{ role: 'user', content: 'hi' }],
	stream: true,
};

function sseResponse(lines: string[]): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const line of lines) {
				controller.enqueue(encoder.encode(line));
			}
			controller.close();
		},
	});
	return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function chunkLine(delta: object, finishReason: string | null = null): string {
	return `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finishReason }], usage: null })}\n\n`;
}

function clientWith(fetchImpl: typeof fetch): MoonshotClient {
	return new MoonshotClient({ baseUrl: 'https://api.moonshot.ai/v1', fetchImpl, timeoutMs: 5_000 });
}

async function collect(events: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
	const out: ChatStreamEvent[] = [];
	for await (const e of events) {
		out.push(e);
	}
	return out;
}

describe('MoonshotClient.streamChat', () => {
	it('streams text deltas as they arrive', async () => {
		const fetchImpl = vi.fn(async () =>
			sseResponse([chunkLine({ content: 'Hello' }), chunkLine({ content: ' world' }, 'stop'), 'data: [DONE]\n\n']),
		) as unknown as typeof fetch;
		const events = await collect(clientWith(fetchImpl).streamChat(REQUEST, 'sk-test'));
		expect(events.filter((e) => e.type === 'text').map((e) => (e as { text: string }).text)).toEqual(['Hello', ' world']);
		expect(events.some((e) => e.type === 'finish' && e.reason === 'stop')).toBe(true);
	});

	it('streams tool-call deltas through', async () => {
		const fetchImpl = vi.fn(async () =>
			sseResponse([
				chunkLine({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":' } }] }),
				chunkLine({ tool_calls: [{ index: 0, function: { arguments: '"/a.ts"}' } }] }, 'tool_calls'),
				'data: [DONE]\n\n',
			]),
		) as unknown as typeof fetch;
		const events = await collect(clientWith(fetchImpl).streamChat(REQUEST, 'sk-test'));
		const deltas = events.filter((e) => e.type === 'toolCallDelta');
		expect(deltas).toHaveLength(2);
	});

	it('surfaces reasoning content as a separate event, not as text', async () => {
		const fetchImpl = vi.fn(async () =>
			sseResponse([chunkLine({ reasoning_content: 'thinking…', content: 'answer' }, 'stop'), 'data: [DONE]\n\n']),
		) as unknown as typeof fetch;
		const events = await collect(clientWith(fetchImpl).streamChat(REQUEST, 'sk-test'));
		expect(events.some((e) => e.type === 'reasoning')).toBe(true);
		expect(events.filter((e) => e.type === 'text')).toHaveLength(1);
	});

	it('emits usage events when include_usage is set', async () => {
		const usageChunk = `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', choices: [], usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } })}\n\n`;
		const fetchImpl = vi.fn(async () => sseResponse([chunkLine({ content: 'x' }, 'stop'), usageChunk, 'data: [DONE]\n\n'])) as unknown as typeof fetch;
		const events = await collect(clientWith(fetchImpl).streamChat(REQUEST, 'sk-test'));
		const usage = events.find((e) => e.type === 'usage');
		expect(usage).toBeDefined();
		expect((usage as { usage: { total_tokens: number } }).usage.total_tokens).toBe(8);
	});

	it('sends the Authorization header and stream flag', async () => {
		let seenInit: RequestInit | undefined;
		const fetchImpl = (async (_url: unknown, init: RequestInit) => {
			seenInit = init;
			return sseResponse(['data: [DONE]\n\n']);
		}) as typeof fetch;
		await collect(clientWith(fetchImpl).streamChat(REQUEST, 'sk-secret-value'));
		const headers = seenInit?.headers as Record<string, string>;
		expect(headers['Authorization']).toBe('Bearer sk-secret-value');
		expect(JSON.parse(String(seenInit?.body)).stream).toBe(true);
	});

	it('classifies HTTP errors (401)', async () => {
		const fetchImpl = vi.fn(async () =>
			new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 }),
		) as unknown as typeof fetch;
		await expect(collect(clientWith(fetchImpl).streamChat(REQUEST, 'sk-bad'))).rejects.toMatchObject({
			kind: 'auth',
			status: 401,
		});
	});

	it('classifies rate limits with retry-after', async () => {
		const fetchImpl = vi.fn(async () =>
			new Response(JSON.stringify({ error: { message: 'too many' } }), { status: 429, headers: { 'retry-after': '30' } }),
		) as unknown as typeof fetch;
		await expect(collect(clientWith(fetchImpl).streamChat(REQUEST, 'sk-x'))).rejects.toMatchObject({
			kind: 'rateLimited',
			retryAfterSeconds: 30,
		});
	});

	it('translates user cancellation into MoonshotAbortError', async () => {
		const controller = new AbortController();
		const fetchImpl = ((_url: unknown, init: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
				setTimeout(() => controller.abort(), 5);
			})) as unknown as typeof fetch;
		await expect(
			collect(clientWith(fetchImpl).streamChat(REQUEST, 'sk-x', controller.signal)),
		).rejects.toBeInstanceOf(MoonshotAbortError);
	});

	it('times out when the server never responds', async () => {
		const fetchImpl = ((_url: unknown, init: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
			})) as unknown as typeof fetch;
		const client = new MoonshotClient({ baseUrl: 'https://api.moonshot.ai/v1', fetchImpl, timeoutMs: 10 });
		await expect(collect(client.streamChat(REQUEST, 'sk-x'))).rejects.toBeInstanceOf(MoonshotTimeoutError);
	});

	it('maps network failures to a network error naming the host', async () => {
		const fetchImpl = vi.fn(async () => {
			throw new TypeError('fetch failed');
		}) as unknown as typeof fetch;
		const error = await collect(clientWith(fetchImpl).streamChat(REQUEST, 'sk-x')).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(MoonshotClientError);
		expect((error as MoonshotClientError).kind).toBe('network');
		expect((error as Error).message).toContain('api.moonshot.ai');
	});

	it('throws a protocol error on malformed stream data', async () => {
		const fetchImpl = vi.fn(async () => sseResponse(['data: {oops}\n\n'])) as unknown as typeof fetch;
		await expect(collect(clientWith(fetchImpl).streamChat(REQUEST, 'sk-x'))).rejects.toMatchObject({
			kind: 'protocol',
		});
	});
});

describe('MoonshotClient.testConnection', () => {
	it('counts models from GET /models', async () => {
		const fetchImpl = vi.fn(async () =>
			new Response(JSON.stringify({ object: 'list', data: [{ id: 'kimi-k3' }, { id: 'kimi-k2.6' }] }), { status: 200 }),
		) as unknown as typeof fetch;
		const result = await clientWith(fetchImpl).testConnection('sk-test');
		expect(result).toEqual({ modelCount: 2, host: 'api.moonshot.ai' });
	});

	it('throws an auth error on 401', async () => {
		const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
		await expect(clientWith(fetchImpl).testConnection('sk-bad')).rejects.toMatchObject({ kind: 'auth' });
	});
});
