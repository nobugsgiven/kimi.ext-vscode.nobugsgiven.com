import { describe, expect, it } from 'vitest';
import { parseToolArguments, ToolCallAssembler } from '../src/moonshot/toolCallAssembler';

describe('ToolCallAssembler', () => {
	it('assembles a tool call from argument deltas', () => {
		const asm = new ToolCallAssembler();
		asm.push({ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"pa' } });
		asm.push({ index: 0, function: { arguments: 'th":"/a.ts"}' } });
		const done = asm.finish();
		expect(done).toEqual([{ id: 'call_1', name: 'read_file', argumentsText: '{"path":"/a.ts"}' }]);
	});

	it('drains a call as complete once a higher index appears', () => {
		const asm = new ToolCallAssembler();
		asm.push({ index: 0, id: 'c0', function: { name: 'a', arguments: '{}' } });
		expect(asm.drainCompleted()).toEqual([]);
		asm.push({ index: 1, id: 'c1', function: { name: 'b', arguments: '{"x":1}' } });
		const drained = asm.drainCompleted();
		expect(drained).toEqual([{ id: 'c0', name: 'a', argumentsText: '{}' }]);
		expect(asm.finish()).toEqual([{ id: 'c1', name: 'b', argumentsText: '{"x":1}' }]);
	});

	it('completes calls in streaming (non-decreasing index) order', () => {
		const asm = new ToolCallAssembler();
		asm.push({ index: 0, id: 'c0', function: { name: 'first', arguments: '{}' } });
		asm.push({ index: 1, id: 'c1', function: { name: 'second', arguments: '{}' } });
		expect(asm.drainCompleted().map((c) => c.name)).toEqual(['first']);
		asm.push({ index: 2, id: 'c2', function: { name: 'third', arguments: '{}' } });
		expect(asm.drainCompleted().map((c) => c.name)).toEqual(['second']);
		expect(asm.finish().map((c) => c.name)).toEqual(['third']);
	});
});

describe('parseToolArguments', () => {
	it('parses valid JSON objects', () => {
		expect(parseToolArguments('{"a":1}')).toEqual({ a: 1 });
	});

	it('returns {} for empty input', () => {
		expect(parseToolArguments('')).toEqual({});
		expect(parseToolArguments('   ')).toEqual({});
	});

	it('wraps JSON scalars', () => {
		expect(parseToolArguments('"text"')).toEqual({ value: 'text' });
	});

	it('reports malformed JSON and returns {}', () => {
		const reported: string[] = [];
		expect(parseToolArguments('{broken', (raw) => reported.push(raw))).toEqual({});
		expect(reported).toEqual(['{broken']);
	});
});
