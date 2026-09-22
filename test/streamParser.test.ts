import { describe, expect, it } from 'vitest';
import { SseParser } from '../src/moonshot/streamParser';
import { MoonshotProtocolError } from '../src/utils/errors';

const chunk = (delta: object) => `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`;

describe('SseParser', () => {
	it('parses complete data lines', () => {
		const parser = new SseParser();
		const events = parser.push(chunk({ content: 'Hi' }));
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe('data');
	});

	it('handles lines split across chunks', () => {
		const parser = new SseParser();
		const full = chunk({ content: 'hello' });
		const events = [
			...parser.push(full.slice(0, 7)),
			...parser.push(full.slice(7, 20)),
			...parser.push(full.slice(20)),
		];
		expect(events).toHaveLength(1);
		expect(events[0].kind).toBe('data');
	});

	it('parses multiple events in one chunk', () => {
		const parser = new SseParser();
		const events = parser.push(chunk({ content: 'a' }) + chunk({ content: 'b' }));
		expect(events).toHaveLength(2);
	});

	it('recognizes the [DONE] sentinel', () => {
		const parser = new SseParser();
		const events = parser.push('data: [DONE]\n\n');
		expect(events).toEqual([{ kind: 'done' }]);
		expect(parser.receivedDone).toBe(true);
	});

	it('ignores comments, keep-alives and blank lines', () => {
		const parser = new SseParser();
		expect(parser.push(': keep-alive\n\n\nevent: message\n\n')).toEqual([]);
	});

	it('handles CRLF line endings', () => {
		const parser = new SseParser();
		const events = parser.push(chunk({ content: 'x' }).replace(/\n/g, '\r\n'));
		expect(events).toHaveLength(1);
	});

	it('processes a trailing line without newline on flush', () => {
		const parser = new SseParser();
		parser.push('data: [DONE]');
		expect(parser.flush()).toEqual([{ kind: 'done' }]);
	});

	it('throws MoonshotProtocolError on malformed JSON', () => {
		const parser = new SseParser();
		expect(() => parser.push('data: {not json}\n\n')).toThrow(MoonshotProtocolError);
	});
});
