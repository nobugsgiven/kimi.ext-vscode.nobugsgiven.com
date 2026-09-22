import * as vscode from 'vscode';
import { ApiKeyManager } from './auth/ApiKeyManager';
import { registerApiKeyCommands, COMMAND_IDS } from './commands/apiKeyCommands';
import { MoonshotClient } from './moonshot/MoonshotClient';
import { KimiLanguageModelProvider } from './provider/KimiLanguageModelProvider';
import { Logger, OUTPUT_CHANNEL_NAME } from './utils/logger';

const PROVIDER_VENDOR = 'nobugsgiven-kimi';
const DEFAULT_BASE_URL = 'https://api.moonshot.ai/v1';
const WELCOME_STATE_KEY = 'nobugsgivenKimi.welcomeShown.v1';

export function activate(context: vscode.ExtensionContext): void {
	const logger = new Logger(
		vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME),
		() => vscode.workspace.getConfiguration('kimi').get<boolean>('diagnostics', false),
	);

	const createClient = () => new MoonshotClient({ baseUrl: getBaseUrl(logger) });
	const apiKeys = new ApiKeyManager(context.secrets);
	const provider = new KimiLanguageModelProvider(apiKeys, createClient, logger);

	context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider(PROVIDER_VENDOR, provider));

	// Keep the model picker in sync with Secret Storage changes.
	context.subscriptions.push(apiKeys.onDidChange(() => provider.refresh()));

	registerApiKeyCommands(context, {
		apiKeys,
		createClient,
		refreshProvider: () => provider.refresh(),
		logger,
	});

	logger.info(`Kimi provider activated (vendor '${PROVIDER_VENDOR}').`);
	void maybeShowWelcome(context);
}

export function deactivate(): void {
	// Nothing to clean up beyond the disposables tracked by the extension context.
}

function getBaseUrl(logger: Logger): string {
	const configured = vscode.workspace.getConfiguration('kimi').get<string>('apiBaseUrl', DEFAULT_BASE_URL).trim();
	try {
		const url = new URL(configured);
		if (url.protocol === 'https:' || url.protocol === 'http:') {
			if (configured !== DEFAULT_BASE_URL) {
				logger.info(`Using custom API base URL: ${url.host}`);
			}
			return configured;
		}
	} catch {
		// fall through to default
	}
	logger.error(`Ignoring invalid kimi.apiBaseUrl value; falling back to ${DEFAULT_BASE_URL}.`);
	return DEFAULT_BASE_URL;
}

/**
 * First-run onboarding (exactly once, tracked in globalState): point the user
 * at 'Kimi: Set API Key' and offer the README. Uses native VS Code UI only.
 */
async function maybeShowWelcome(context: vscode.ExtensionContext): Promise<void> {
	if (context.globalState.get<boolean>(WELCOME_STATE_KEY)) {
		return;
	}
	await context.globalState.update(WELCOME_STATE_KEY, true);

	const hasKey = await context.secrets.get('nobugsgivenKimi.moonshotApiKey');
	if (hasKey) {
		return; // key already configured (e.g. reinstall) — no onboarding needed
	}

	const choice = await vscode.window.showInformationMessage(
		"Welcome to Kimi K3 (Moonshot API) - No Bugs Given! To get started, run 'Kimi: Set API Key'.",
		'Set API Key',
		'Open README',
	);
	if (choice === 'Set API Key') {
		void vscode.commands.executeCommand(COMMAND_IDS.setApiKey);
	} else if (choice === 'Open README') {
		const readme = vscode.Uri.joinPath(context.extensionUri, 'README.md');
		void vscode.commands.executeCommand('markdown.showPreview', readme);
	}
}
