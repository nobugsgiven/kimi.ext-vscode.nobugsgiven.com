/**
 * Optional live integration tests against the real Moonshot API.
 *
 * These run only when explicitly enabled and a key is present:
 *   KIMI_INTEGRATION=1 MOONSHOT_API_KEY=sk-... npm test
 * (or `npm run test:integration`, which sets KIMI_INTEGRATION for you).
 *
 * No API key is ever stored in this repository.
 */
import { describe, expect, it } from 'vitest';
import { MoonshotClient } from '../src/moonshot/MoonshotClient';

const ENABLED = process.env['KIMI_INTEGRATION'] === '1';
const API_KEY = process.env['MOONSHOT_API_KEY'];
const RUN = ENABLED && !!API_KEY;

describe.skipIf(!RUN)('Moonshot API (live integration)', () => {
	const client = new MoonshotClient({
		baseUrl: process.env['KIMI_API_BASE_URL'] ?? 'https://api.moonshot.ai/v1',
	});

	it('validates the key via GET /models', async () => {
		const result = await client.testConnection(API_KEY as string);
		expect(result.modelCount).toBeGreaterThan(0);
	}, 30_000);

	it('streams a tiny chat completion', async () => {
		const texts: string[] = [];
		for await (const event of client.streamChat(
			{
				model: 'kimi-k2.6',
				messages: [
					{ role: 'user', content: 'Reply with exactly the word "pong" and nothing else.' },
				],
				stream: true,
				max_completion_tokens: 64,
			},
			API_KEY as string,
		)) {
			if (event.type === 'text') {
				texts.push(event.text);
			}
		}
		expect(texts.join('').toLowerCase()).toContain('pong');
	}, 60_000);
});
