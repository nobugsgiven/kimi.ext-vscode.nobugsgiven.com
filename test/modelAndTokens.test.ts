import { describe, expect, it } from 'vitest';
import { estimateMessageTokens, estimateTokens } from '../src/utils/tokenCount';
import { KIMI_MODELS, findModel, toChatInformation } from '../src/provider/modelDefinitions';

describe('estimateTokens', () => {
	it('returns 0 for empty text', () => {
		expect(estimateTokens('')).toBe(0);
	});

	it('approximates ~4 chars/token for ASCII', () => {
		const text = 'a'.repeat(400);
		const tokens = estimateTokens(text);
		expect(tokens).toBeGreaterThan(80);
		expect(tokens).toBeLessThan(120);
	});

	it('counts CJK characters at ~1 token each', () => {
		const tokens = estimateTokens('你好世界这是一个测试句子');
		expect(tokens).toBeGreaterThanOrEqual(10);
		expect(tokens).toBeLessThanOrEqual(14);
	});

	it('adds message overhead', () => {
		expect(estimateMessageTokens('')).toBeGreaterThan(estimateTokens(''));
	});
});

describe('model definitions', () => {
	it('exposes exactly the three Kimi models', () => {
		expect(KIMI_MODELS.map((m) => m.apiId)).toEqual(['kimi-k3', 'kimi-k2.6', 'kimi-k2.5']);
	});

	it('maps definitions to LanguageModelChatInformation with honest capabilities', () => {
		for (const def of KIMI_MODELS) {
			const info = toChatInformation(def);
			expect(info.id).toBe(def.apiId);
			expect(info.family).toBe('kimi');
			expect(info.maxInputTokens).toBeGreaterThan(0);
			expect(info.maxOutputTokens).toBeGreaterThan(0);
			expect(info.maxInputTokens + info.maxOutputTokens).toBeLessThanOrEqual(1_048_576);
			expect(info.capabilities.toolCalling).toBe(true);
			expect(info.capabilities.imageInput).toBe(true);
		}
	});

	it('finds models by id and returns undefined for unknown ids', () => {
		expect(findModel('kimi-k3')?.displayName).toBe('Kimi K3');
		expect(findModel('kimi-k9')).toBeUndefined();
	});
});
