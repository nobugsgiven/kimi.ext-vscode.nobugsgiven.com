import * as vscode from 'vscode';
import type { ApiKeyManager } from '../auth/ApiKeyManager';
import type { MoonshotClient } from '../moonshot/MoonshotClient';
import { toMoonshotMessages, toMoonshotTools } from '../moonshot/messageConverter';
import { parseToolArguments, ToolCallAssembler } from '../moonshot/toolCallAssembler';
import type { MoonshotChatRequest } from '../moonshot/types';
import { MoonshotClientError } from '../utils/errors';
import type { Logger } from '../utils/logger';
import { estimateMessageTokens, estimateTokens } from '../utils/tokenCount';
import { findModel, KIMI_MODELS, toChatInformation } from './modelDefinitions';

const SET_API_KEY_COMMAND = 'nobugsgivenKimi.setApiKey';

/**
 * The VS Code Language Model Chat Provider that surfaces Kimi models in the
 * standard Copilot Chat model picker. All network work is delegated to
 * {@link MoonshotClient}; this class only translates between the VS Code
 * world and the Moonshot world.
 */
export class KimiLanguageModelProvider implements vscode.LanguageModelChatProvider {
	private readonly _onDidChangeLanguageModelChatInformation = new vscode.EventEmitter<void>();
	readonly onDidChangeLanguageModelChatInformation = this._onDidChangeLanguageModelChatInformation.event;

	/** Ensures the "configure your key" prompt appears at most once per session. */
	private promptedForKeyThisSession = false;

	constructor(
		private readonly apiKeys: ApiKeyManager,
		private readonly createClient: () => MoonshotClient,
		private readonly logger: Logger,
	) {}

	/** Ask VS Code to re-query the model list (after the API key changes). */
	refresh(): void {
		this._onDidChangeLanguageModelChatInformation.fire();
	}

	async provideLanguageModelChatInformation(
		options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		const hasKey = await this.apiKeys.hasApiKey();
		if (!hasKey) {
			if (options.silent) {
				// VS Code is enumerating providers in the background — stay quiet.
				return [];
			}
			this.offerApiKeySetup();
			return [];
		}
		return KIMI_MODELS.map(toChatInformation);
	}

	async provideLanguageModelChatResponse(
		model: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const definition = findModel(model.id);
		if (!definition) {
			throw vscode.LanguageModelError.NotFound(`Unknown Kimi model '${model.id}'.`);
		}

		const apiKey = await this.apiKeys.getApiKey();
		if (!apiKey) {
			throw vscode.LanguageModelError.NoPermissions(
				"Moonshot API key is not configured. Run 'Kimi: Set API Key' from the Command Palette.",
			);
		}

		const request = this.buildRequest(definition.apiId, definition.supportsImages, messages, options);
		const client = this.createClient();
		this.logger.debug(`POST ${client.host}/chat/completions model=${definition.apiId} messages=${request.messages.length} tools=${request.tools?.length ?? 0}`);

		const abortController = new AbortController();
		const cancellationSubscription = token.onCancellationRequested(() => abortController.abort());

		try {
			const assembler = new ToolCallAssembler();
			const reportCall = (call: { id: string; name: string; argumentsText: string }) => {
				const input = parseToolArguments(call.argumentsText, (raw) =>
					this.logger.error(`Discarding malformed tool-call arguments from the model (tool '${call.name}').`, raw),
				);
				progress.report(new vscode.LanguageModelToolCallPart(call.id, call.name, input));
			};

			for await (const event of client.streamChat(request, apiKey, abortController.signal)) {
				if (token.isCancellationRequested) {
					return;
				}
				switch (event.type) {
					case 'text':
						progress.report(new vscode.LanguageModelTextPart(event.text));
						break;
					case 'reasoning':
						// Kimi K3/K2.6 thinking traces. Not surfaced in chat: the
						// stable VS Code API has no user-facing reasoning part, and
						// internal reasoning must not leak into the conversation.
						this.logger.debug(`reasoning delta (${event.text.length} chars, not displayed)`);
						break;
					case 'toolCallDelta':
						assembler.push(event.delta);
						for (const completed of assembler.drainCompleted()) {
							reportCall(completed);
						}
						break;
					case 'usage':
						this.logger.debug(
							`usage: prompt=${event.usage.prompt_tokens} completion=${event.usage.completion_tokens} total=${event.usage.total_tokens}`,
						);
						break;
					case 'finish':
						this.logger.debug(`finish_reason=${event.reason ?? 'unknown'}`);
						break;
				}
			}
			for (const remaining of assembler.finish()) {
				reportCall(remaining);
			}
		} catch (error) {
			// An intentional Stop in Copilot Chat is not an error.
			if (token.isCancellationRequested || error instanceof MoonshotClientError && error.kind === 'aborted') {
				return;
			}
			throw this.toLanguageModelError(error);
		} finally {
			cancellationSubscription.dispose();
		}
	}

	async provideTokenCount(
		_model: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		if (typeof text === 'string') {
			return estimateTokens(text);
		}
		let total = 0;
		for (const part of text.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				total += estimateMessageTokens(part.value);
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				total += estimateMessageTokens(part.name + JSON.stringify(part.input));
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				for (const sub of part.content) {
					if (sub instanceof vscode.LanguageModelTextPart) {
						total += estimateTokens(sub.value);
					}
				}
			} else if (part instanceof vscode.LanguageModelDataPart) {
				// Images are billed at a fixed-ish rate by most providers; budget generously.
				total += part.mimeType.startsWith('image/') ? 1024 : estimateTokens(Buffer.from(part.data).toString('utf8'));
			}
		}
		return Math.max(1, total);
	}

	private buildRequest(
		apiId: string,
		supportsImages: boolean,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
	): MoonshotChatRequest {
		const request: MoonshotChatRequest = {
			model: apiId,
			messages: toMoonshotMessages(messages, {
				allowImages: supportsImages,
				log: (msg) => this.logger.debug(msg),
			}),
			stream: true,
			stream_options: { include_usage: true },
			...toMoonshotTools(options.tools, options.toolMode),
		};

		// Pass through a small allowlist of documented model options.
		const modelOptions = options.modelOptions ?? {};
		if (typeof modelOptions['temperature'] === 'number') {
			request.temperature = modelOptions['temperature'];
		}
		if (typeof modelOptions['top_p'] === 'number') {
			request.top_p = modelOptions['top_p'];
		}
		if (typeof modelOptions['max_completion_tokens'] === 'number') {
			request.max_completion_tokens = modelOptions['max_completion_tokens'];
		}
		if (apiId === 'kimi-k3' && isReasoningEffort(modelOptions['reasoning_effort'])) {
			request.reasoning_effort = modelOptions['reasoning_effort'];
		}
		if (apiId === 'kimi-k2.6' && isThinkingOption(modelOptions['thinking'])) {
			request.thinking = modelOptions['thinking'];
		}
		return request;
	}

	private offerApiKeySetup(): void {
		if (this.promptedForKeyThisSession) {
			return;
		}
		this.promptedForKeyThisSession = true;
		void vscode.window
			.showInformationMessage(
				"Moonshot API key is not configured. Run 'Kimi: Set API Key' to use Kimi models in Copilot Chat.",
				'Set API Key',
			)
			.then((choice) => {
				if (choice === 'Set API Key') {
					void vscode.commands.executeCommand(SET_API_KEY_COMMAND);
				}
			});
	}

	private toLanguageModelError(error: unknown): vscode.LanguageModelError {
		if (error instanceof vscode.LanguageModelError) {
			return error;
		}
		if (error instanceof MoonshotClientError) {
			this.logger.error(`Moonshot request failed (kind=${error.kind}${error.status ? `, HTTP ${error.status}` : ''})`, error);
			switch (error.kind) {
				case 'auth':
				case 'forbidden':
					return vscode.LanguageModelError.NoPermissions(error.message);
				case 'notFound':
					return vscode.LanguageModelError.NotFound(error.message);
				case 'rateLimited':
				case 'badRequest':
				case 'server':
				case 'network':
				case 'timeout':
					return new vscode.LanguageModelError(error.message);
				default:
					return new vscode.LanguageModelError(error.message);
			}
		}
		this.logger.error('Unexpected error during chat request', error);
		return new vscode.LanguageModelError('An unexpected error occurred while contacting the Moonshot API.');
	}
}

function isReasoningEffort(value: unknown): value is 'low' | 'high' | 'max' {
	return value === 'low' || value === 'high' || value === 'max';
}

function isThinkingOption(value: unknown): value is { type: 'enabled' | 'disabled'; keep?: 'all' | null } {
	return (
		typeof value === 'object' &&
		value !== null &&
		((value as { type?: unknown }).type === 'enabled' || (value as { type?: unknown }).type === 'disabled')
	);
}
