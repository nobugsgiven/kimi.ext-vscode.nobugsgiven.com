import * as vscode from 'vscode';
import type {
	MoonshotChatMessage,
	MoonshotContentPart,
	MoonshotToolCall,
	MoonshotToolChoice,
	MoonshotToolDefinition,
} from './types';

export interface ConversionOptions {
	/** Whether the target model accepts image input (all Kimi K3/K2.x models do). */
	allowImages: boolean;
	/** Optional sink for notes about dropped/converted content. */
	log?: (message: string) => void;
}

const SUPPORTED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

/**
 * Convert VS Code chat request messages into Moonshot's OpenAI-compatible
 * message structure.
 *
 * Mapping rules:
 *  - Assistant text + tool-call parts -> one `assistant` message with
 *    `content` and `tool_calls`.
 *  - User text + image data parts -> one `user` message with a content-part
 *    array (plain string when text-only).
 *  - `LanguageModelToolResultPart`s -> separate `tool` messages carrying
 *    `tool_call_id`, preserving order relative to surrounding content.
 *  - VS Code has no System role in the provider API; system instructions
 *    arrive as user-role messages and are passed through unchanged.
 */
export function toMoonshotMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
	options: ConversionOptions,
): MoonshotChatMessage[] {
	const out: MoonshotChatMessage[] = [];

	for (const message of messages) {
		if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
			out.push(convertAssistantMessage(message, options));
			continue;
		}

		// User-role message: may mix text, images and tool results.
		let pendingContent: MoonshotContentPart[] = [];
		const flushUserContent = () => {
			if (pendingContent.length === 0) {
				return;
			}
			out.push({
				role: 'user',
				content: collapseContent(pendingContent),
				...(message.name ? { name: message.name } : {}),
			});
			pendingContent = [];
		};

		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelToolResultPart) {
				flushUserContent();
				out.push({
					role: 'tool',
					tool_call_id: part.callId,
					content: toolResultToText(part),
				});
			} else if (part instanceof vscode.LanguageModelTextPart) {
				if (part.value.length > 0) {
					pendingContent.push({ type: 'text', text: part.value });
				}
			} else if (part instanceof vscode.LanguageModelDataPart) {
				const converted = convertDataPart(part, options);
				if (converted) {
					pendingContent.push(converted);
				}
			} else {
				options.log?.(`Skipped an unrecognized message part (${describePart(part)}).`);
			}
		}
		flushUserContent();
	}

	return out;
}

function convertAssistantMessage(
	message: vscode.LanguageModelChatRequestMessage,
	options: ConversionOptions,
): MoonshotChatMessage {
	const textSegments: string[] = [];
	const toolCalls: MoonshotToolCall[] = [];

	for (const part of message.content) {
		if (part instanceof vscode.LanguageModelTextPart) {
			textSegments.push(part.value);
		} else if (part instanceof vscode.LanguageModelToolCallPart) {
			toolCalls.push({
				id: part.callId,
				type: 'function',
				function: { name: part.name, arguments: safeStringify(part.input) },
			});
		} else if (part instanceof vscode.LanguageModelDataPart) {
			// Thinking traces echoed back by VS Code are intentionally not
			// forwarded; Kimi re-derives reasoning per request.
			options.log?.('Skipped a data part on an assistant message.');
		}
	}

	const content = textSegments.join('');
	const converted: MoonshotChatMessage = {
		role: 'assistant',
		content: content.length > 0 ? content : toolCalls.length > 0 ? null : '',
	};
	if (toolCalls.length > 0) {
		converted.tool_calls = toolCalls;
	}
	return converted;
}

function convertDataPart(part: vscode.LanguageModelDataPart, options: ConversionOptions): MoonshotContentPart | undefined {
	if (part.mimeType.startsWith('image/')) {
		if (!options.allowImages) {
			options.log?.(`Dropped an image (${part.mimeType}) because the selected model does not accept image input.`);
			return undefined;
		}
		if (!SUPPORTED_IMAGE_MIMES.has(part.mimeType)) {
			options.log?.(`Dropped an image with unsupported MIME type ${part.mimeType}.`);
			return undefined;
		}
		const base64 = Buffer.from(part.data).toString('base64');
		return { type: 'image_url', image_url: { url: `data:${part.mimeType};base64,${base64}` } };
	}
	if (part.mimeType.startsWith('text/') || part.mimeType === 'application/json') {
		const text = Buffer.from(part.data).toString('utf8');
		if (text.length > 0) {
			return { type: 'text', text };
		}
	}
	options.log?.(`Skipped a data part with MIME type ${part.mimeType}.`);
	return undefined;
}

/** Collapse a single text part to a plain string — keeps the wire format simple for text-only turns. */
function collapseContent(parts: MoonshotContentPart[]): string | MoonshotContentPart[] {
	if (parts.length === 1 && parts[0].type === 'text') {
		return parts[0].text;
	}
	if (parts.every((p) => p.type === 'text')) {
		return parts.map((p) => (p as { text: string }).text).join('\n');
	}
	return parts;
}

function toolResultToText(part: vscode.LanguageModelToolResultPart): string {
	const segments: string[] = [];
	for (const sub of part.content) {
		if (sub instanceof vscode.LanguageModelTextPart) {
			segments.push(sub.value);
		} else if (sub instanceof vscode.LanguageModelDataPart) {
			if (sub.mimeType.startsWith('text/') || sub.mimeType === 'application/json') {
				segments.push(Buffer.from(sub.data).toString('utf8'));
			}
		} else if (sub !== null && typeof sub === 'object' && 'value' in sub) {
			segments.push(String((sub as { value: unknown }).value));
		}
	}
	return segments.join('\n');
}

function safeStringify(input: unknown): string {
	try {
		return JSON.stringify(input ?? {});
	} catch {
		return '{}';
	}
}

function describePart(part: unknown): string {
	if (part !== null && typeof part === 'object' && part.constructor) {
		return part.constructor.name;
	}
	return typeof part;
}

/**
 * Map VS Code's tool list + tool mode onto Moonshot's `tools` / `tool_choice`.
 */
export function toMoonshotTools(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
	toolMode: vscode.LanguageModelChatToolMode | undefined,
): { tools?: MoonshotToolDefinition[]; tool_choice?: MoonshotToolChoice } {
	if (!tools || tools.length === 0) {
		return {};
	}
	const converted: MoonshotToolDefinition[] = tools.map((tool) => ({
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters: (tool.inputSchema as Record<string, unknown> | undefined) ?? {
				type: 'object',
				properties: {},
			},
		},
	}));
	const tool_choice: MoonshotToolChoice =
		toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto';
	return { tools: converted, tool_choice };
}
