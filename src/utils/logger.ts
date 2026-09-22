import type * as vscode from 'vscode';
import { sanitize } from './errors';

export const OUTPUT_CHANNEL_NAME = 'Kimi - No Bugs Given';

/**
 * Output-channel logger. Verbose diagnostics are opt-in via the
 * `kimi.diagnostics` setting. Every line passes through {@link sanitize},
 * which masks API-key-shaped strings and Bearer headers before anything is
 * written.
 */
export class Logger {
	constructor(
		private readonly channel: vscode.OutputChannel,
		private readonly verboseEnabled: () => boolean,
	) {}

	info(message: string): void {
		this.write('info', message);
	}

	debug(message: string): void {
		if (this.verboseEnabled()) {
			this.write('debug', message);
		}
	}

	error(message: string, error?: unknown): void {
		const detail = error instanceof Error ? ` — ${error.message}` : error ? ` — ${String(error)}` : '';
		this.write('error', message + detail);
	}

	show(): void {
		this.channel.show(true);
	}

	private write(level: 'info' | 'debug' | 'error', message: string): void {
		const timestamp = new Date().toISOString();
		this.channel.appendLine(`[${timestamp}] [${level}] ${sanitize(message)}`);
	}
}
