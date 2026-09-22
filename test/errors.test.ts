import { describe, expect, it } from 'vitest';
import { classifyHttpError, extractApiErrorMessage, sanitize } from '../src/utils/errors';

describe('classifyHttpError', () => {
	const body = (msg: string) => JSON.stringify({ error: { message: msg, type: 'invalid_request_error' } });

	it('maps 400 to badRequest with the API message', () => {
		const err = classifyHttpError(400, body('max tokens exceeded'));
		expect(err.kind).toBe('badRequest');
		expect(err.message).toContain('max tokens exceeded');
		expect(err.status).toBe(400);
	});

	it('maps 401 to auth with a friendly message that does not echo the body', () => {
		const err = classifyHttpError(401, body('invalid key'));
		expect(err.kind).toBe('auth');
		expect(err.message).toContain('Kimi: Set API Key');
	});

	it('maps 403 to forbidden', () => {
		expect(classifyHttpError(403, body('nope')).kind).toBe('forbidden');
	});

	it('maps 404 to notFound', () => {
		expect(classifyHttpError(404, body('model not found')).kind).toBe('notFound');
	});

	it('maps 429 to rateLimited and surfaces retry-after', () => {
		const err = classifyHttpError(429, body('slow down'), '17');
		expect(err.kind).toBe('rateLimited');
		expect(err.retryAfterSeconds).toBe(17);
		expect(err.message).toContain('17 seconds');
	});

	it('maps 5xx to server without echoing raw bodies', () => {
		const err = classifyHttpError(502, '<html>bad gateway</html>');
		expect(err.kind).toBe('server');
		expect(err.message).not.toContain('<html>');
	});

	it('maps other statuses to http', () => {
		expect(classifyHttpError(418, body('teapot')).kind).toBe('http');
	});
});

describe('extractApiErrorMessage', () => {
	it('extracts the error.message field', () => {
		expect(extractApiErrorMessage(JSON.stringify({ error: { message: 'boom' } }))).toBe('boom');
	});

	it('truncates huge raw bodies', () => {
		const long = 'x'.repeat(5000);
		const result = extractApiErrorMessage(long);
		expect(result.length).toBeLessThan(400);
	});
});

describe('sanitize', () => {
	it('masks Moonshot-shaped API keys', () => {
		expect(sanitize('failed with key sk-abc123XYZ_-secret9')).toBe('failed with key sk-…[redacted]');
	});

	it('masks Bearer headers', () => {
		expect(sanitize('Authorization: Bearer sk-something-long')).toBe('Authorization: Bearer [redacted]');
	});

	it('leaves ordinary text untouched', () => {
		expect(sanitize('rate limit reached')).toBe('rate limit reached');
	});
});
