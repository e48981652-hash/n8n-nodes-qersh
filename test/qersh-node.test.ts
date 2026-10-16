import type { ICredentialTestFunctions, IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import vectors from '../fixtures/test-vectors.json';
import { Qersh } from '../nodes/Qersh/Qersh.node';
import { qershWebhookApiTest } from '../nodes/Qersh/credentialTest';

interface VectorCase { name: string; now: number; secrets: string[]; headers: Record<string, string>; body: string }
const cases = (vectors as { cases: VectorCase[] }).cases;
const valid = cases.find((c) => c.name === 'valid_transfer_received')!;
const lower = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));

function context(params: Record<string, unknown>, options: { items?: INodeExecutionData[]; binary?: Buffer | null; key?: string; continueOnFail?: boolean } = {}) {
	const ctx = mock<IExecuteFunctions>();
	ctx.getInputData.mockReturnValue(options.items ?? [{ json: {} }]);
	ctx.getNodeParameter.mockImplementation(((name: string, _i: number, fallback?: unknown) => (name in params ? params[name] : fallback)) as never);
	ctx.getCredentials.mockResolvedValue({ connectionSecret: options.key ?? valid.secrets[0] } as never);
	ctx.continueOnFail.mockReturnValue(options.continueOnFail ?? false);
	ctx.getNode.mockReturnValue({ name: 'Qersh', type: 'qersh', typeVersion: 1, position: [0, 0], parameters: {} } as never);
	(ctx as unknown as { helpers: unknown }).helpers = {
		getBinaryDataBuffer: async () => {
			if (options.binary === null) throw new Error('no binary');
			return options.binary ?? Buffer.from(valid.body, 'utf8');
		},
	};
	return ctx;
}

const node = new Qersh();
const first = async (ctx: IExecuteFunctions) => ((await node.execute.call(ctx))[0]?.[0]?.json ?? {}) as IDataObject;

describe('Qersh node', () => {
	it('declares the usableAsTool property and tests the credential from every operation that uses it', () => {
		expect(node.description.usableAsTool).toBe(true);
		for (const c of node.description.credentials ?? []) expect(c.testedBy).toBe('qershWebhookApiTest');
		expect(node.description.properties.find((p) => p.name === 'operation')?.noDataExpression).toBe(true);
	});

	it('Verify Delivery: a valid raw body yields the normalised delivery with verification.valid', async () => {
		vi.useFakeTimers({ now: valid.now * 1000 });
		const out = await first(context({ operation: 'verifyDelivery', signatureHeader: valid.headers['X-Qersh-Signature'], binaryPropertyName: 'data', requestHeaders: lower(valid.headers) }));
		expect(out.verification).toEqual({ valid: true, key_index: 0 });
		expect(out.event).toBe('transfer.received');
		expect(out.attempt).toBe(1);
		expect((out.transfer as IDataObject).amount_minor).toBe(15007);
		vi.useRealTimers();
	});

	it('Verify Delivery: a tampered body, a wrong key and a missing raw body are invalid with a reason', async () => {
		vi.useFakeTimers({ now: valid.now * 1000 });
		const tampered = cases.find((c) => c.name === 'tampered_body')!;
		const bad = await first(context({ operation: 'verifyDelivery', signatureHeader: tampered.headers['X-Qersh-Signature'], binaryPropertyName: 'data', requestHeaders: {} }, { binary: Buffer.from(tampered.body, 'utf8') }));
		expect(bad.verification).toMatchObject({ valid: false, reason: 'bad_signature' });
		const wrongKey = await first(context({ operation: 'verifyDelivery', signatureHeader: valid.headers['X-Qersh-Signature'], binaryPropertyName: 'data' }, { key: 'qsk_wrongwrongwrongwrongwrongwrongwrongwrongwro' }));
		expect(wrongKey.verification).toMatchObject({ valid: false, reason: 'bad_signature' });
		const noBody = await first(context({ operation: 'verifyDelivery', signatureHeader: valid.headers['X-Qersh-Signature'], binaryPropertyName: 'data' }, { binary: null }));
		expect(noBody.verification).toMatchObject({ valid: false, reason: 'raw_body_unavailable' });
		expect((noBody.verification as IDataObject).hint).toContain('Raw Body');
		vi.useRealTimers();
	});

	it('Build Setup Link: key-less by default, with the key only when asked, invalid URLs refused', async () => {
		const plain = await first(context({ operation: 'buildSetupLink', webhookUrl: 'https://n8n.example.com/webhook/qersh', label: 'Shop', provider: 'vodafone_cash', linkEvents: [], includeConnectionKey: false }));
		expect(plain.setup_url).toBe('qersh://setup?v=1&url=' + encodeURIComponent('https://n8n.example.com/webhook/qersh') + '&label=Shop&provider=vodafone_cash');
		expect(plain.includes_key).toBe(false);
		expect(String(plain.setup_url)).not.toContain('secret');

		const withKey = await first(context({ operation: 'buildSetupLink', webhookUrl: 'https://n8n.example.com/webhook/qersh', label: '', provider: '', linkEvents: ['transfer.received'], includeConnectionKey: true }));
		expect(String(withKey.setup_url)).toContain('&secret=' + encodeURIComponent(valid.secrets[0]!));
		expect(String(withKey.setup_url)).toContain('&events=transfer.received');
		expect(withKey.warnings).toEqual(['secret_included']);

		await expect(node.execute.call(context({ operation: 'buildSetupLink', webhookUrl: 'http://n8n.example.com/webhook/qersh', label: '', provider: '', linkEvents: [], includeConnectionKey: false }))).rejects.toThrow(/url_insecure_remote/);

		const tolerant = await first(context({ operation: 'buildSetupLink', webhookUrl: 'ftp://x', label: '', provider: '', linkEvents: [], includeConnectionKey: false }, { continueOnFail: true }));
		expect(String(tolerant.error)).toContain('url_scheme');
	});

	it('Match Transfer: finds the order by payer and time and returns the reply for the phone', async () => {
		const now = Date.now();
		const transfer = { transfer_id: 'trf_1', auto_confirm_ok: true, amount_minor: 15000, received_at: new Date(now - 60_000).toISOString(), payer: { number: '01112233445', handle: null, name: 'A', key: '01112233445' } };
		const orders = [
			{ order_number: 'ORD-1', price_minor: 15000, payer_key: '01112233445', created_at: new Date(now - 10 * 60_000).toISOString(), expires_at: new Date(now + 60 * 60_000).toISOString() },
			{ order_number: 'ORD-2', price_minor: 15000, payer_key: '01099999999', created_at: new Date(now - 10 * 60_000).toISOString(), expires_at: new Date(now + 60 * 60_000).toISOString() },
		];
		const out = await first(context({ operation: 'matchTransfer', transfer, orders: JSON.stringify(orders), options: {} }));
		expect(out).toMatchObject({ status: 'matched', reference: 'ORD-1', order_number: 'ORD-1', action: 'mark_paid', amount_minor: 15000, transfer_id: 'trf_1', stop_order: false });
	});

	it('Match Transfer: a transfer.updated is judged instead of matched', async () => {
		const update = { transfer_id: 'trf_1', updated_fields: ['checks.balance_chain'], checks: { balance_chain: 'refuted' }, risk_reasons: ['suspected_forgery'] };
		const out = await first(context({ operation: 'matchTransfer', transfer: update, orders: '[]', options: {} }));
		expect(out).toEqual({ status: 'ok', transfer_id: 'trf_1', stop_order: true, reason: 'suspected_forgery' });
	});
});

describe('credential test', () => {
	const run = (connectionSecret: unknown) => qershWebhookApiTest.call(mock<ICredentialTestFunctions>(), { id: '1', name: 'x', type: 'qershWebhookApi', data: { connectionSecret } } as never);
	it('accepts a Qersh-shaped key and refuses the rest, checking the format only', async () => {
		expect((await run(valid.secrets[0])).status).toBe('OK');
		expect((await run('a-merchant-chosen-secret-of-24')).status).toBe('OK');
		expect((await run('qsk_short')).status).toBe('Error');
		expect((await run('')).status).toBe('Error');
	});
});
