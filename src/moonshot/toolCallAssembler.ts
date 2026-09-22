import type { MoonshotToolCallDelta } from './types';

export interface AssembledToolCall {
	id: string;
	name: string;
	/** The raw (JSON-encoded) argument string, fully accumulated. */
	argumentsText: string;
}

interface PartialToolCall {
	id: string;
	name: string;
	argumentsText: string;
	started: boolean;
}

/**
 * Reassembles streamed OpenAI-style tool-call deltas into complete tool
 * calls. Deltas for one call share an `index`; a call is considered complete
 * once a delta for a higher index arrives, or when the stream finishes.
 */
export class ToolCallAssembler {
	private readonly partials = new Map<number, PartialToolCall>();
	private highestIndex = -1;

	push(delta: MoonshotToolCallDelta): void {
		let partial = this.partials.get(delta.index);
		if (!partial) {
			partial = { id: '', name: '', argumentsText: '', started: true };
			this.partials.set(delta.index, partial);
		}
		if (delta.id) {
			partial.id = delta.id;
		}
		if (delta.function?.name) {
			partial.name += delta.function.name;
		}
		if (delta.function?.arguments) {
			partial.argumentsText += delta.function.arguments;
		}
		if (delta.index > this.highestIndex) {
			this.highestIndex = delta.index;
		}
	}

	/**
	 * Returns calls that are guaranteed complete because a delta for a higher
	 * index has since arrived. Safe to call after every {@link push}.
	 */
	drainCompleted(): AssembledToolCall[] {
		const completed: AssembledToolCall[] = [];
		for (const [index, partial] of this.partials) {
			if (index < this.highestIndex) {
				completed.push({ id: partial.id, name: partial.name, argumentsText: partial.argumentsText });
				this.partials.delete(index);
			}
		}
		return completed;
	}

	/** Returns every remaining call; call when the stream has ended. */
	finish(): AssembledToolCall[] {
		const remaining: AssembledToolCall[] = [];
		const sorted = [...this.partials.entries()].sort(([a], [b]) => a - b);
		for (const [, partial] of sorted) {
			remaining.push({ id: partial.id, name: partial.name, argumentsText: partial.argumentsText });
		}
		this.partials.clear();
		return remaining;
	}
}

/**
 * Parse a completed tool-call argument string into the input object VS Code
 * expects. Returns `{}` for empty input. Throws nothing — malformed JSON is
 * reported via `onMalformed` and yields `{}` so a broken stream cannot crash
 * the chat request.
 */
export function parseToolArguments(argumentsText: string, onMalformed?: (raw: string) => void): object {
	const trimmed = argumentsText.trim();
	if (trimmed.length === 0) {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (parsed !== null && typeof parsed === 'object') {
			return parsed as object;
		}
		// A JSON scalar/array is still a legitimate (if unusual) tool input.
		return { value: parsed };
	} catch {
		onMalformed?.(trimmed);
		return {};
	}
}
