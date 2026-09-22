/**
 * Heuristic token estimation for Kimi models.
 *
 * Moonshot does not currently document a public token-count endpoint, and
 * bundling a full BPE tokenizer would add a heavy dependency. VS Code uses
 * this only for context budgeting, so an approximation is acceptable.
 *
 * The heuristic is calibrated for Kimi's tokenizer behavior:
 *  - ASCII / Latin text: ~4 characters per token
 *  - CJK characters: ~1 token per character
 *  - Everything else: ~2 characters per token
 *
 * Expected accuracy is roughly ±15%. This module is intentionally isolated:
 * replace `estimateTokens` with an exact tokenizer later without touching
 * the provider.
 */

const MESSAGE_OVERHEAD_TOKENS = 4;

function isCjk(codePoint: number): boolean {
	return (
		(codePoint >= 0x4e00 && codePoint <= 0x9fff) || // CJK Unified Ideographs
		(codePoint >= 0x3400 && codePoint <= 0x4dbf) || // Extension A
		(codePoint >= 0x3000 && codePoint <= 0x303f) || // CJK punctuation
		(codePoint >= 0xff00 && codePoint <= 0xffef) || // Fullwidth forms
		(codePoint >= 0x3040 && codePoint <= 0x30ff) || // Hiragana + Katakana
		(codePoint >= 0xac00 && codePoint <= 0xd7af) // Hangul syllables
	);
}

export function estimateTokens(text: string): number {
	if (text.length === 0) {
		return 0;
	}
	let ascii = 0;
	let cjk = 0;
	let other = 0;
	for (const ch of text) {
		const cp = ch.codePointAt(0) ?? 0;
		if (cp < 0x80) {
			ascii++;
		} else if (isCjk(cp)) {
			cjk++;
		} else {
			other++;
		}
	}
	return Math.max(1, Math.ceil(ascii / 4 + cjk + other / 2));
}

/** Estimate tokens for a whole chat message, including per-message framing overhead. */
export function estimateMessageTokens(text: string): number {
	return MESSAGE_OVERHEAD_TOKENS + estimateTokens(text);
}
