/**
 * Minimal mock of the 'vscode' module for unit tests running outside the
 * Extension Host. Only the surface used by src/ is implemented.
 */

export enum LanguageModelChatMessageRole {
	User = 1,
	Assistant = 2,
}

export enum LanguageModelChatToolMode {
	Auto = 1,
	Required = 2,
}

export class LanguageModelTextPart {
	value: string;
	constructor(value: string) {
		this.value = value;
	}
}

export class LanguageModelToolCallPart {
	callId: string;
	name: string;
	input: object;
	constructor(callId: string, name: string, input: object) {
		this.callId = callId;
		this.name = name;
		this.input = input;
	}
}

export class LanguageModelToolResultPart {
	callId: string;
	content: Array<LanguageModelTextPart | LanguageModelDataPart | unknown>;
	constructor(callId: string, content: Array<LanguageModelTextPart | LanguageModelDataPart | unknown>) {
		this.callId = callId;
		this.content = content;
	}
}

export class LanguageModelDataPart {
	mimeType: string;
	data: Uint8Array;
	constructor(data: Uint8Array, mimeType: string) {
		this.data = data;
		this.mimeType = mimeType;
	}
	static image(data: Uint8Array, mime: string): LanguageModelDataPart {
		return new LanguageModelDataPart(data, mime);
	}
	static json(value: unknown, mime = 'application/json'): LanguageModelDataPart {
		return new LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(value)), mime);
	}
	static text(value: string, mime = 'text/plain'): LanguageModelDataPart {
		return new LanguageModelDataPart(new TextEncoder().encode(value), mime);
	}
}

export class LanguageModelError extends Error {
	readonly code: string;
	constructor(message?: string, code = 'Unknown') {
		super(message);
		this.code = code;
	}
	static NoPermissions(message?: string): LanguageModelError {
		return new LanguageModelError(message, 'NoPermissions');
	}
	static Blocked(message?: string): LanguageModelError {
		return new LanguageModelError(message, 'Blocked');
	}
	static NotFound(message?: string): LanguageModelError {
		return new LanguageModelError(message, 'NotFound');
	}
}

export interface LanguageModelChatTool {
	name: string;
	description: string;
	inputSchema?: object | undefined;
}
