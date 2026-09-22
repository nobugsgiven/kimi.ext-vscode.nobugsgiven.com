import { MoonshotProtocolError } from '../utils/errors';

export type SseEvent = { kind: 'data'; json: unknown } | { kind: 'done' };

/**
 * Incremental parser for Server-Sent Events as produced by the Moonshot
 * streaming chat completions endpoint (`data: {...}\n\n` lines terminated by
 * `data: [DONE]`).
 *
 * Feed decoded text via {@link push}; it returns every complete event found.
 * Handles lines split across network chunks, comment lines and keep-alives.
 */
export class SseParser {
	private buffer = '';
	private sawDone = false;

	/** Feed a chunk of decoded text; returns the complete SSE events it contained. */
	push(chunk: string): SseEvent[] {
		this.buffer += chunk;
		const events: SseEvent[] = [];

		let lineEnd: { index: number; length: number } | undefined;
		while ((lineEnd = this.findLineEnd()) !== undefined) {
			const rawLine = this.buffer.slice(0, lineEnd.index);
			this.buffer = this.buffer.slice(lineEnd.index + lineEnd.length);
			const event = this.parseLine(rawLine);
			if (event) {
				events.push(event);
				if (event.kind === 'done') {
					this.sawDone = true;
				}
			}
		}
		return events;
	}

	/** Process any trailing bytes after the stream closed. */
	flush(): SseEvent[] {
		const events: SseEvent[] = [];
		const trailing = this.buffer;
		this.buffer = '';
		if (trailing.trim().length > 0) {
			const event = this.parseLine(trailing);
			if (event) {
				events.push(event);
				if (event.kind === 'done') {
					this.sawDone = true;
				}
			}
		}
		return events;
	}

	get receivedDone(): boolean {
		return this.sawDone;
	}

	private findLineEnd(): { index: number; length: number } | undefined {
		const rn = this.buffer.indexOf('\r\n');
		const n = this.buffer.indexOf('\n');
		if (rn !== -1 && (n === -1 || rn <= n - 1)) {
			return { index: rn, length: 2 };
		}
		if (n !== -1) {
			return { index: n, length: 1 };
		}
		return undefined;
	}

	private parseLine(rawLine: string): SseEvent | undefined {
		const line = rawLine.trim();
		// Blank lines, comments/keep-alives and non-data fields carry no payload.
		if (line.length === 0 || line.startsWith(':') || !line.startsWith('data:')) {
			return undefined;
		}
		const payload = line.slice('data:'.length).trim();
		if (payload === '[DONE]') {
			return { kind: 'done' };
		}
		try {
			return { kind: 'data', json: JSON.parse(payload) };
		} catch (cause) {
			throw new MoonshotProtocolError(
				'Received malformed streaming data from the Moonshot API.',
				cause,
			);
		}
	}
}
