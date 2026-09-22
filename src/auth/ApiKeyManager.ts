import * as vscode from 'vscode';

const SECRET_KEY = 'nobugsgivenKimi.moonshotApiKey';

/**
 * Thin wrapper over VS Code SecretStorage. This is the ONLY place the
 * Moonshot API key is persisted — never settings.json, never workspace
 * state, never files.
 */
export class ApiKeyManager {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	/** Fires whenever the stored key is set, replaced or deleted. */
	readonly onDidChange = this._onDidChange.event;

	constructor(private readonly secrets: vscode.SecretStorage) {}

	async getApiKey(): Promise<string | undefined> {
		const key = await this.secrets.get(SECRET_KEY);
		const trimmed = key?.trim();
		return trimmed ? trimmed : undefined;
	}

	async hasApiKey(): Promise<boolean> {
		return (await this.getApiKey()) !== undefined;
	}

	async setApiKey(key: string): Promise<void> {
		const trimmed = key.trim();
		if (!trimmed) {
			throw new Error('API key must not be empty.');
		}
		await this.secrets.store(SECRET_KEY, trimmed);
		this._onDidChange.fire();
	}

	async deleteApiKey(): Promise<void> {
		await this.secrets.delete(SECRET_KEY);
		this._onDidChange.fire();
	}
}
