import type { LanguageModelChatInformation } from 'vscode';

/**
 * Static metadata for the Kimi models exposed by this provider, based on
 * Moonshot's official model documentation (https://platform.kimi.ai/docs/models).
 *
 * `maxInputTokens` reserves headroom for the model's output budget inside the
 * documented context window, which is how VS Code expects the two numbers to
 * relate (input + output <= context).
 */
export interface KimiModelDefinition {
	/** Moonshot API model id, sent as `model` in chat completion requests. */
	readonly apiId: string;
	/** Name shown in the Copilot Chat model picker. */
	readonly displayName: string;
	readonly family: 'kimi';
	readonly version: string;
	readonly maxInputTokens: number;
	readonly maxOutputTokens: number;
	readonly supportsImages: boolean;
	readonly supportsTools: boolean;
	readonly detail: string;
	readonly tooltip: string;
}

const K3_CONTEXT = 1_048_576; // 1M documented context window
const K3_MAX_OUTPUT = 131_072; // documented default max_completion_tokens
const K26_CONTEXT = 262_144; // 256K documented context window
const K26_MAX_OUTPUT = 32_768; // conservative output budget (not publicly documented)
const K25_CONTEXT = 262_144; // 256K context window
const K25_MAX_OUTPUT = 16_384;

export const KIMI_MODELS: readonly KimiModelDefinition[] = [
	{
		apiId: 'kimi-k3',
		displayName: 'Kimi K3',
		family: 'kimi',
		version: '3.0',
		maxInputTokens: K3_CONTEXT - K3_MAX_OUTPUT,
		maxOutputTokens: K3_MAX_OUTPUT,
		supportsImages: true,
		supportsTools: true,
		detail: 'Moonshot API · 1M context · flagship',
		tooltip:
			'Kimi K3 — Moonshot AI flagship model for software engineering, deep reasoning and agent tasks. ' +
			'1M token context, native visual understanding, always-on reasoning, tool calling.',
	},
	{
		apiId: 'kimi-k2.6',
		displayName: 'Kimi K2.6',
		family: 'kimi',
		version: '2.6',
		maxInputTokens: K26_CONTEXT - K26_MAX_OUTPUT,
		maxOutputTokens: K26_MAX_OUTPUT,
		supportsImages: true,
		supportsTools: true,
		detail: 'Moonshot API · 256K context',
		tooltip:
			'Kimi K2.6 — general-purpose Kimi model for dialogue and agent tasks. ' +
			'256K token context, visual understanding, optional thinking mode, tool calling.',
	},
	{
		apiId: 'kimi-k2.5',
		displayName: 'Kimi K2.5',
		family: 'kimi',
		version: '2.5',
		maxInputTokens: K25_CONTEXT - K25_MAX_OUTPUT,
		maxOutputTokens: K25_MAX_OUTPUT,
		supportsImages: true,
		supportsTools: true,
		detail: 'Moonshot API · 256K context · deprecated by Moonshot',
		tooltip:
			'Kimi K2.5 — previous-generation general Kimi model. ' +
			'Note: Moonshot lists kimi-k2.5 as discontinued (Aug 31, 2026); requests may fail — migrate to Kimi K3.',
	},
];

export function findModel(apiId: string): KimiModelDefinition | undefined {
	return KIMI_MODELS.find((m) => m.apiId === apiId);
}

export function toChatInformation(def: KimiModelDefinition): LanguageModelChatInformation {
	return {
		id: def.apiId,
		name: def.displayName,
		family: def.family,
		version: def.version,
		maxInputTokens: def.maxInputTokens,
		maxOutputTokens: def.maxOutputTokens,
		detail: def.detail,
		tooltip: def.tooltip,
		capabilities: {
			imageInput: def.supportsImages,
			toolCalling: def.supportsTools,
		},
	};
}
