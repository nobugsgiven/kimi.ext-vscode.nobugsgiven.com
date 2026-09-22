import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { toMoonshotMessages, toMoonshotTools } from '../src/moonshot/messageConverter';

function userMessage(...content: unknown[]): vscode.LanguageModelChatRequestMessage {
	return { role: vscode.LanguageModelChatMessageRole.User, content, name: undefined };
}

function assistantMessage(...content: unknown[]): vscode.LanguageModelChatRequestMessage {
	return { role: vscode.LanguageModelChatMessageRole.Assistant, content, name: undefined };
}

const OPTS = { allowImages: true };

describe('toMoonshotMessages', () => {
	it('converts a plain user text message to a string content', () => {
		const result = toMoonshotMessages([userMessage(new vscode.LanguageModelTextPart('hello'))], OPTS);
		expect(result).toEqual([{ role: 'user', content: 'hello' }]);
	});

	it('joins multiple text parts on one user message', () => {
		const result = toMoonshotMessages(
			[userMessage(new vscode.LanguageModelTextPart('a'), new vscode.LanguageModelTextPart('b'))],
			OPTS,
		);
		expect(result).toEqual([{ role: 'user', content: 'a\nb' }]);
	});

	it('maps assistant text messages', () => {
		const result = toMoonshotMessages([assistantMessage(new vscode.LanguageModelTextPart('answer'))], OPTS);
		expect(result).toEqual([{ role: 'assistant', content: 'answer' }]);
	});

	it('preserves multi-turn structure and order', () => {
		const result = toMoonshotMessages(
			[
				userMessage(new vscode.LanguageModelTextPart('q1')),
				assistantMessage(new vscode.LanguageModelTextPart('a1')),
				userMessage(new vscode.LanguageModelTextPart('q2')),
			],
			OPTS,
		);
		expect(result.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
	});

	it('maps assistant tool calls to the tool_calls structure', () => {
		const result = toMoonshotMessages(
			[
				assistantMessage(
					new vscode.LanguageModelTextPart('Let me check.'),
					new vscode.LanguageModelToolCallPart('call_1', 'read_file', { path: '/a.ts' }),
				),
			],
			OPTS,
		);
		expect(result).toEqual([
			{
				role: 'assistant',
				content: 'Let me check.',
				tool_calls: [
					{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"/a.ts"}' } },
				],
			},
		]);
	});

	it('uses null content for tool-call-only assistant messages', () => {
		const result = toMoonshotMessages(
			[assistantMessage(new vscode.LanguageModelToolCallPart('call_9', 'noop', {}))],
			OPTS,
		);
		expect(result[0].content).toBeNull();
		expect(result[0].tool_calls).toHaveLength(1);
	});

	it('converts tool result parts into tool role messages with matching ids', () => {
		const result = toMoonshotMessages(
			[
				userMessage(
					new vscode.LanguageModelToolResultPart('call_1', [new vscode.LanguageModelTextPart('file contents')]),
				),
			],
			OPTS,
		);
		expect(result).toEqual([{ role: 'tool', tool_call_id: 'call_1', content: 'file contents' }]);
	});

	it('supports multiple tool results in a single user message', () => {
		const result = toMoonshotMessages(
			[
				userMessage(
					new vscode.LanguageModelToolResultPart('c1', [new vscode.LanguageModelTextPart('r1')]),
					new vscode.LanguageModelToolResultPart('c2', [new vscode.LanguageModelTextPart('r2')]),
				),
			],
			OPTS,
		);
		expect(result).toEqual([
			{ role: 'tool', tool_call_id: 'c1', content: 'r1' },
			{ role: 'tool', tool_call_id: 'c2', content: 'r2' },
		]);
	});

	it('keeps text before/after tool results as separate user messages', () => {
		const result = toMoonshotMessages(
			[
				userMessage(
					new vscode.LanguageModelTextPart('before'),
					new vscode.LanguageModelToolResultPart('c1', [new vscode.LanguageModelTextPart('r')]),
					new vscode.LanguageModelTextPart('after'),
				),
			],
			OPTS,
		);
		expect(result).toEqual([
			{ role: 'user', content: 'before' },
			{ role: 'tool', tool_call_id: 'c1', content: 'r' },
			{ role: 'user', content: 'after' },
		]);
	});

	it('converts image data parts to base64 image_url parts', () => {
		const png = new Uint8Array([137, 80, 78, 71]);
		const result = toMoonshotMessages(
			[
				userMessage(
					new vscode.LanguageModelTextPart('what is this?'),
					vscode.LanguageModelDataPart.image(png, 'image/png'),
				),
			],
			OPTS,
		);
		expect(result).toHaveLength(1);
		const content = result[0].content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
		expect(content[0]).toEqual({ type: 'text', text: 'what is this?' });
		expect(content[1].type).toBe('image_url');
		expect(content[1].image_url?.url).toBe(`data:image/png;base64,${Buffer.from(png).toString('base64')}`);
	});

	it('drops images when the model does not support them', () => {
		const notes: string[] = [];
		const result = toMoonshotMessages(
			[
				userMessage(
					new vscode.LanguageModelTextPart('hi'),
					vscode.LanguageModelDataPart.image(new Uint8Array([1]), 'image/png'),
				),
			],
			{ allowImages: false, log: (m) => notes.push(m) },
		);
		expect(result).toEqual([{ role: 'user', content: 'hi' }]);
		expect(notes).toHaveLength(1);
	});

	it('decodes text data parts into text content', () => {
		const result = toMoonshotMessages(
			[userMessage(vscode.LanguageModelDataPart.text('inline note'))],
			OPTS,
		);
		expect(result).toEqual([{ role: 'user', content: 'inline note' }]);
	});

	it('skips unknown parts without breaking the message', () => {
		const result = toMoonshotMessages(
			[userMessage(new vscode.LanguageModelTextPart('keep'), { mystery: true })],
			OPTS,
		);
		expect(result).toEqual([{ role: 'user', content: 'keep' }]);
	});

	it('stringifies tool-call inputs safely', () => {
		const circular: Record<string, unknown> = {};
		circular['self'] = circular;
		const result = toMoonshotMessages(
			[assistantMessage(new vscode.LanguageModelToolCallPart('c', 'tool', circular))],
			OPTS,
		);
		expect(result[0].tool_calls?.[0].function.arguments).toBe('{}');
	});
});

describe('toMoonshotTools', () => {
	const tool: vscode.LanguageModelChatTool = {
		name: 'run_tests',
		description: 'Run the test suite',
		inputSchema: { type: 'object', properties: { filter: { type: 'string' } } },
	};

	it('returns an empty object when no tools are provided', () => {
		expect(toMoonshotTools(undefined, undefined)).toEqual({});
		expect(toMoonshotTools([], undefined)).toEqual({});
	});

	it('maps tool definitions to the function format', () => {
		const { tools, tool_choice } = toMoonshotTools([tool], vscode.LanguageModelChatToolMode.Auto);
		expect(tools).toEqual([
			{ type: 'function', function: { name: 'run_tests', description: 'Run the test suite', parameters: tool.inputSchema } },
		]);
		expect(tool_choice).toBe('auto');
	});

	it('maps Required tool mode to tool_choice "required"', () => {
		expect(toMoonshotTools([tool], vscode.LanguageModelChatToolMode.Required).tool_choice).toBe('required');
	});

	it('provides a default schema when inputSchema is missing', () => {
		const { tools } = toMoonshotTools([{ name: 'ping', description: 'Ping' }], undefined);
		expect(tools?.[0].function.parameters).toEqual({ type: 'object', properties: {} });
	});
});
