// The credential's Test button: n8n resolves `test.request` with its expression engine (with `$credentials` in
// scope), issues the request through its HTTP layer and applies the rules. These tests run n8n-workflow's own engine
// over the real method expression: it must follow the app's key rule, and the key must never be part of the request.
import { Expression } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { QershWebhookApi } from '../credentials/QershWebhookApi.credentials';
import vectors from '../fixtures/test-vectors.json';
import { isAcceptableKey } from '../nodes/Qersh/lib/core/config';
import { isUsableSecret } from '../nodes/Qersh/lib/core/setup-link';

const credential = new QershWebhookApi();
const methodExpression = credential.test.request.method as string;
const url = credential.test.request.url as string;
const GOOD = (vectors as { secret: string }).secret;

const method = (connectionSecret: unknown): string => {
	const value = Expression.resolveWithoutWorkflow(methodExpression.replace(/^=/, ''), { $credentials: { connectionSecret } });
	if (typeof value !== 'string') throw new Error(`expression returned ${typeof value}`);
	return value;
};

describe('credential test request', () => {
	it('targets a constant data: URL (no network, no key in it) and explains a 405', () => {
		expect(url).toBe('data:text/plain,qersh-connection-key-shape-check');
		expect(methodExpression.startsWith('={{')).toBe(true);
		expect(credential.test.rules).toEqual([{ type: 'responseCode', properties: { value: 405, message: expect.stringContaining('at least 24 characters') } }]);
	});

	it('GETs for the shapes the app accepts and POSTs for the rest: isAcceptableKey plus the qsk_ alphabet', () => {
		const cases: Array<[unknown, boolean]> = [
			[GOOD, true],
			['a-merchant-chosen-secret-of-24', true],
			['  ' + GOOD + '\n', true],
			['qsk_' + 'x'.repeat(30) + '*', false],
			['short', false],
			['qsk_has a space in it long enough', false],
			['tab\there-is-a-long-enough-key', false],
			['', false],
			[undefined, false],
			[null, false],
			[42, false],
		];
		for (const [key, expected] of cases) {
			const label = JSON.stringify(key);
			expect(method(key), label).toBe(expected ? 'GET' : 'POST');
			if (typeof key === 'string') expect(isAcceptableKey(key) && isUsableSecret(key), label).toBe(expected);
		}
	});

	it('resolves to nothing but the verb: the key never reaches the request', () => {
		for (const key of [GOOD, 'a-merchant-chosen-secret-of-24', 'short', 'qsk_' + 'x'.repeat(30) + '*']) {
			expect(['GET', 'POST']).toContain(method(key));
			expect(url).not.toContain(key.slice(0, 8));
		}
	});
});
