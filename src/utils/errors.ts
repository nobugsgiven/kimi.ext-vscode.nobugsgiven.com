/**
 * Error types and classification for the Moonshot API layer.
 *
 * This module is deliberately free of `vscode` imports so it stays unit
 * testable; the provider layer maps {@link MoonshotClientError.kind} onto
 * `vscode.LanguageModelError` values.
 */

export type MoonshotErrorKind =
	| 'badRequest'
	| 'auth'
	| 'forbidden'
	| 'notFound'
	| 'rateLimited'
	| 'server'
	| 'network'
	| 'timeout'
	| 'aborted'
	| 'protocol'
	| 'http';

export class MoonshotClientError extends Error {
	constructor(
		readonly kind: MoonshotErrorKind,
		message: string,
		readonly status?: number,
		readonly retryAfterSeconds?: number,
	) {
		super(sanitize(message));
		this.name = 'MoonshotClientError';
	}
}

export class MoonshotAbortError extends MoonshotClientError {
	constructor(message = 'The request was cancelled.') {
		super('aborted', message);
		this.name = 'MoonshotAbortError';
	}
}

export class MoonshotTimeoutError extends MoonshotClientError {
	constructor(message = 'The Moonshot API did not respond in time.') {
		super('timeout', message);
		this.name = 'MoonshotTimeoutError';
	}
}

export class MoonshotProtocolError extends MoonshotClientError {
	constructor(message: string, readonly cause?: unknown) {
		super('protocol', message);
		this.name = 'MoonshotProtocolError';
	}
}

/**
 * Defense-in-depth scrubbing for any text that might reach logs, output
 * channels or error messages. The API key must never appear anywhere, so we
 * mask anything shaped like a Moonshot key (`sk-...`) or a Bearer header.
 */
export function sanitize(text: string): string {
	return text
		.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
		.replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-…[redacted]');
}

/**
 * Best-effort extraction of the human-readable message from a Moonshot error
 * body (`{ "error": { "message": ... } }`), truncated so giant raw JSON blobs
 * never reach the user.
 */
export function extractApiErrorMessage(bodyText: string, maxLength = 300): string {
	let message: string | undefined;
	try {
		const parsed = JSON.parse(bodyText) as { error?: { message?: unknown } };
		if (typeof parsed.error?.message === 'string') {
			message = parsed.error.message;
		}
	} catch {
		// Not JSON — fall through to the raw-truncated body.
	}
	message ??= bodyText.trim();
	if (message.length > maxLength) {
		message = message.slice(0, maxLength) + '…';
	}
	return sanitize(message);
}

/**
 * Translate an HTTP status + body into a classified {@link MoonshotClientError}.
 */
export function classifyHttpError(status: number, bodyText: string, retryAfterHeader?: string | null): MoonshotClientError {
	const detail = extractApiErrorMessage(bodyText);
	const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) || undefined : undefined;

	switch (status) {
		case 400:
			return new MoonshotClientError(
				'badRequest',
				`The Moonshot API rejected the request: ${detail}`,
				status,
			);
		case 401:
			return new MoonshotClientError(
				'auth',
				'The Moonshot API key is invalid or has expired. Run "Kimi: Set API Key" to configure a new key.',
				status,
			);
		case 403:
			return new MoonshotClientError(
				'forbidden',
				'The Moonshot API key is not authorized for this operation. Check the key and account permissions.',
				status,
			);
		case 404:
			return new MoonshotClientError(
				'notFound',
				`The requested model or endpoint was not found on the Moonshot API. ${detail}`,
				status,
			);
		case 429:
			return new MoonshotClientError(
				'rateLimited',
				retryAfterSeconds
					? `Moonshot API rate limit reached. Please try again in about ${retryAfterSeconds} seconds.`
					: 'Moonshot API rate limit reached. Please wait a moment and try again.',
				status,
				retryAfterSeconds,
			);
		default:
			if (status >= 500) {
				return new MoonshotClientError(
					'server',
					`The Moonshot API is temporarily unavailable (HTTP ${status}). Please try again later.`,
					status,
				);
			}
			return new MoonshotClientError('http', `Unexpected Moonshot API response (HTTP ${status}): ${detail}`, status);
	}
}
