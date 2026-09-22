import * as vscode from 'vscode';
import type { ApiKeyManager } from '../auth/ApiKeyManager';
import type { MoonshotClient } from '../moonshot/MoonshotClient';
import { MoonshotClientError } from '../utils/errors';
import type { Logger } from '../utils/logger';

export const COMMAND_IDS = {
	setApiKey: 'nobugsgivenKimi.setApiKey',
	resetApiKey: 'nobugsgivenKimi.resetApiKey',
	manageApiKey: 'nobugsgivenKimi.manageApiKey',
	testApiConnection: 'nobugsgivenKimi.testApiConnection',
} as const;

const DOCS_URL = 'https://platform.kimi.ai/docs';
const API_KEYS_URL = 'https://platform.kimi.ai/console/api-keys';

export interface CommandDeps {
	apiKeys: ApiKeyManager;
	createClient: () => MoonshotClient;
	refreshProvider: () => void;
	logger: Logger;
}

export function registerApiKeyCommands(context: vscode.ExtensionContext, deps: CommandDeps): void {
	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_IDS.setApiKey, () => setApiKey(deps)),
		vscode.commands.registerCommand(COMMAND_IDS.resetApiKey, () => resetApiKey(deps)),
		vscode.commands.registerCommand(COMMAND_IDS.manageApiKey, () => manageApiKey(deps)),
		vscode.commands.registerCommand(COMMAND_IDS.testApiConnection, () => testApiConnection(deps)),
	);
}

async function setApiKey(deps: CommandDeps): Promise<void> {
	const existing = await deps.apiKeys.hasApiKey();
	const key = await vscode.window.showInputBox({
		title: existing ? 'Kimi: Replace Moonshot API Key' : 'Kimi: Set Moonshot API Key',
		prompt: 'Enter your Moonshot API key. It is stored in VS Code Secret Storage and never written to settings or files.',
		placeHolder: 'sk-...',
		password: true,
		ignoreFocusOut: true,
		validateInput: (value) => (value.trim().length === 0 ? 'API key must not be empty.' : undefined),
	});
	if (key === undefined) {
		return; // user cancelled
	}
	await deps.apiKeys.setApiKey(key);
	deps.refreshProvider();
	deps.logger.info('Moonshot API key stored in Secret Storage.');
	void vscode.window.showInformationMessage(
		'Moonshot API key saved. Kimi K3, Kimi K2.6 and Kimi K2.5 are now available in the Copilot Chat model picker.',
	);
}

async function resetApiKey(deps: CommandDeps): Promise<void> {
	if (!(await deps.apiKeys.hasApiKey())) {
		void vscode.window.showInformationMessage('No Moonshot API key is currently stored.');
		return;
	}
	const confirmation = await vscode.window.showWarningMessage(
		'Delete the stored Moonshot API key? Kimi models will no longer appear in the Copilot Chat model picker.',
		{ modal: true },
		'Delete Key',
	);
	if (confirmation !== 'Delete Key') {
		return;
	}
	await deps.apiKeys.deleteApiKey();
	deps.refreshProvider();
	deps.logger.info('Moonshot API key deleted.');
	void vscode.window.showInformationMessage('Moonshot API key deleted.');
}

async function manageApiKey(deps: CommandDeps): Promise<void> {
	const hasKey = await deps.apiKeys.hasApiKey();
	interface ActionItem extends vscode.QuickPickItem {
		run: () => Thenable<void> | void;
	}
	const items: ActionItem[] = [
		{
			label: hasKey ? '$(key) Replace API Key' : '$(key) Set API Key',
			description: hasKey ? 'a key is currently stored' : 'no key stored yet',
			run: () => setApiKey(deps),
		},
		{
			label: '$(plug) Test API Connection',
			description: 'validate key and connectivity via GET /models',
			run: () => testApiConnection(deps),
		},
		...(hasKey
			? [
					{
						label: '$(trash) Reset API Key',
						description: 'delete the stored key',
						run: () => resetApiKey(deps),
					} satisfies ActionItem,
				]
			: []),
		{
			label: '$(book) Open Documentation',
			description: DOCS_URL,
			run: () => {
				void vscode.env.openExternal(vscode.Uri.parse(DOCS_URL));
			},
		},
		{
			label: '$(link-external) Get an API Key',
			description: API_KEYS_URL,
			run: () => {
				void vscode.env.openExternal(vscode.Uri.parse(API_KEYS_URL));
			},
		},
		{
			label: '$(gear) Open Endpoint Settings',
			description: 'kimi.apiBaseUrl (advanced)',
			run: () => vscode.commands.executeCommand('workbench.action.openSettings', 'kimi.apiBaseUrl'),
		},
	];
	const picked = await vscode.window.showQuickPick(items, {
		title: 'Kimi: Manage API Key',
		placeHolder: 'Moonshot API key management',
	});
	await picked?.run();
}

async function testApiConnection(deps: CommandDeps): Promise<void> {
	const apiKey = await deps.apiKeys.getApiKey();
	if (!apiKey) {
		const choice = await vscode.window.showInformationMessage(
			"Moonshot API key is not configured. Run 'Kimi: Set API Key' from the Command Palette.",
			'Set API Key',
		);
		if (choice === 'Set API Key') {
			await setApiKey(deps);
		}
		return;
	}

	const client = deps.createClient();
	try {
		const result = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: `Testing Moonshot API connection (${client.host})…` },
			() => client.testConnection(apiKey),
		);
		deps.logger.info(`Connection test succeeded against ${result.host} (${result.modelCount} models visible).`);
		void vscode.window.showInformationMessage(
			`Moonshot API connection OK — ${result.host} reachable, key valid, ${result.modelCount} models visible to this key.`,
		);
	} catch (error) {
		const message = friendlyTestError(error, client.host);
		deps.logger.error('Connection test failed', error);
		if (error instanceof MoonshotClientError && (error.kind === 'auth' || error.kind === 'forbidden')) {
			const choice = await vscode.window.showErrorMessage(message, 'Replace API Key');
			if (choice === 'Replace API Key') {
				await setApiKey(deps);
			}
		} else {
			void vscode.window.showErrorMessage(message);
		}
	}
}

function friendlyTestError(error: unknown, host: string): string {
	if (error instanceof MoonshotClientError) {
		return error.message;
	}
	return `Could not reach the Moonshot API at ${host}. Check your network connection and the kimi.apiBaseUrl setting.`;
}
