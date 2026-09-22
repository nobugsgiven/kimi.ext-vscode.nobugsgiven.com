/**
 * Type definitions for Moonshot AI's OpenAI-compatible Chat Completions API.
 * Reference: https://platform.kimi.ai/docs/api/chat
 *
 * These types are intentionally free of any `vscode` imports so the whole
 * Moonshot layer stays unit-testable outside the Extension Host.
 */

export type MoonshotRole = 'system' | 'user' | 'assistant' | 'tool';

export interface MoonshotTextContentPart {
	type: 'text';
	text: string;
}

export interface MoonshotImageContentPart {
	type: 'image_url';
	image_url: {
		/** A https URL or a base64 data URL (`data:image/png;base64,...`). */
		url: string;
	};
}

export type MoonshotContentPart = MoonshotTextContentPart | MoonshotImageContentPart;

export interface MoonshotToolCallFunction {
	name: string;
	/** JSON-encoded arguments, as produced by the model. */
	arguments: string;
}

export interface MoonshotToolCall {
	id: string;
	type: 'function';
	function: MoonshotToolCallFunction;
}

export interface MoonshotChatMessage {
	role: MoonshotRole;
	content: string | MoonshotContentPart[] | null;
	name?: string;
	tool_call_id?: string;
	tool_calls?: MoonshotToolCall[];
}

export interface MoonshotToolDefinition {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
}

export type MoonshotToolChoice =
	| 'auto'
	| 'none'
	| 'required'
	| { type: 'function'; function: { name: string } };

export interface MoonshotChatRequest {
	model: string;
	messages: MoonshotChatMessage[];
	stream: boolean;
	stream_options?: { include_usage?: boolean };
	tools?: MoonshotToolDefinition[];
	tool_choice?: MoonshotToolChoice;
	temperature?: number;
	top_p?: number;
	max_completion_tokens?: number;
	/** Kimi K3 only. */
	reasoning_effort?: 'low' | 'high' | 'max';
	/** Kimi K2.6 only. */
	thinking?: { type: 'enabled' | 'disabled'; keep?: 'all' | null };
}

export interface MoonshotUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
}

// ---------------------------------------------------------------------------
// Streaming (SSE) wire format
// ---------------------------------------------------------------------------

export interface MoonshotToolCallDelta {
	index: number;
	id?: string;
	type?: string;
	function?: {
		name?: string;
		arguments?: string;
	};
}

export interface MoonshotChatChunkDelta {
	role?: string;
	content?: string | null;
	/** Reasoning trace emitted by thinking models (Kimi K3, K2.6 thinking). */
	reasoning_content?: string | null;
	tool_calls?: MoonshotToolCallDelta[];
}

export interface MoonshotChatChunkChoice {
	index: number;
	delta: MoonshotChatChunkDelta;
	finish_reason: string | null;
}

export interface MoonshotChatChunk {
	id: string;
	object: 'chat.completion.chunk';
	choices: MoonshotChatChunkChoice[];
	usage?: MoonshotUsage | null;
}

/** GET /models response (OpenAI-compatible). */
export interface MoonshotModelList {
	object: 'list';
	data: Array<{ id: string; object: string; owned_by?: string }>;
}

/** Error body returned by the Moonshot API. */
export interface MoonshotErrorBody {
	error?: {
		message?: string;
		type?: string;
		code?: string;
	};
}

// ---------------------------------------------------------------------------
// Normalized stream events consumed by the VS Code provider layer
// ---------------------------------------------------------------------------

export type ChatStreamEvent =
	| { type: 'text'; text: string }
	| { type: 'reasoning'; text: string }
	| { type: 'toolCallDelta'; delta: MoonshotToolCallDelta }
	| { type: 'usage'; usage: MoonshotUsage }
	| { type: 'finish'; reason: string | null };
