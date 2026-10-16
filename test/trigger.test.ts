import type { IDataObject, IWebhookFunctions } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';
import { mock } from 'vitest-mock-extended';

import vectors from '../fixtures/test-vectors.json';
import { QershTrigger } from '../nodes/Qersh/QershTrigger.node';

interface VectorCase {
	name: string;
	now: number;
	secrets: string[];
	headers: Record<string, string>;
	body: string;
	expect: 'accept' | 'reject';
}
const cases = (vectors as { cases: VectorCase[] }).cases;
const valid = cases.find((c) => c.name === 'valid_transfer_received')!;
const lower = (h: Record<string, string>) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));

interface Setup {
	body?: string | Buffer | null;
	headers?: Record<string, string>;
	key?: string | null;
	events?: string[];
	responseMode?: string;
}

function context(setup: Setup) {
	const res = { status: vi.fn(), json: vi.fn() };
	res.status.mockReturnValue(res);
	const headers = lower(setup.headers ?? valid.headers);
	const rawBody = setup.body === null ? undefined : Buffer.from(setup.body ?? valid.body, 'utf8');
	const params: Record<string, unknown> = {
		path: 'qersh',
		events: setup.events ?? ['transfer.received', 'transfer.updated', 'webhook.test'],
		responseMode: setup.responseMode ?? 'lastNode',
	};
	const ctx = mock<IWebhookFunctions>();
	ctx.getRequestObject.mockReturnValue({ rawBody, headers } as never);
	ctx.getResponseObject.mockReturnValue(res as never);
	ctx.getHeaderData.mockReturnValue(headers as never);
	ctx.getNodeParameter.mockImplementation(((name: string, fallback?: unknown) => params[name] ?? fallback) as never);
	ctx.getNodeWebhookUrl.mockReturnValue('https://n8n.example.com/webhook/qersh');
	if (setup.key === null) ctx.getCredentials.mockRejectedValue(new Error('Node does not have any credentials set'));
	else ctx.getCredentials.mockResolvedValue({ connectionSecret: setup.key ?? valid.secrets[0] } as never);
	(ctx as unknown as { helpers: unknown }).helpers = {
		returnJsonArray: (data: IDataObject | IDataObject[]) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
	};
	return { ctx, res };
}

const trigger = new QershTrigger();
const useFakeClock = (seconds: number) => vi.useFakeTimers({ now: seconds * 1000 });

describe('Qersh Trigger', () => {
	it('declares what n8n and its lint expect', () => {
		const d = trigger.description;
		expect(d.name).toBe('qershTrigger');
		expect(d.displayName).toContain('Trigger');
		expect(d.inputs).toEqual([]);
		expect(d.group).toEqual(['trigger']);
		expect(d.webhooks?.[0]).toMatchObject({ httpMethod: 'POST', isFullPath: true, responseData: 'firstEntryJson' });
		expect(d.credentials?.[0]).toMatchObject({ name: 'qershWebhookApi', required: true, testedBy: 'qershWebhookApiTest' });
		expect(Object.keys(trigger.webhookMethods.default)).toEqual(['checkExists', 'create', 'delete']);
		expect((d as { usableAsTool?: boolean }).usableAsTool).toBeUndefined();
	});

	it('accepts and rejects the kit vectors exactly, answering 401 itself on a rejection', async () => {
		for (const c of cases) {
			useFakeClock(c.now);
			const { ctx, res } = context({ body: c.body, headers: c.headers, key: c.secrets[0] });
			const result = await trigger.webhook.call(ctx);
			if (c.expect === 'accept') {
				expect(result.workflowData, c.name).toBeDefined();
				expect(res.status, c.name).not.toHaveBeenCalled();
			} else {
				expect(result, c.name).toEqual({ noWebhookResponse: true });
				expect(res.status, c.name).toHaveBeenCalledWith(401);
				expect(res.json.mock.calls[0]?.[0], c.name).toMatchObject({ error: 'invalid_signature' });
			}
		}
		vi.useRealTimers();
	});

	it('emits one normalised item in last-node mode and lets n8n answer', async () => {
		useFakeClock(valid.now);
		const { ctx, res } = context({});
		const result = await trigger.webhook.call(ctx);
		expect(res.status).not.toHaveBeenCalled();
		expect(result.noWebhookResponse).toBeUndefined();
		const item = result.workflowData?.[0]?.[0]?.json as IDataObject;
		expect(item.event).toBe('transfer.received');
		expect(item.delivery_id).toBe('3f2a9c6e-1b7d-4e8a-9f0c-5d6e7a8b9c0d');
		expect(item.attempt).toBe(1);
		expect(item.webhook_url).toBe('https://n8n.example.com/webhook/qersh');
		expect((item.transfer as IDataObject).amount_minor).toBe(15007);
		expect(((item.transfer as IDataObject).payer as IDataObject).key).toBe('01112233445');
		expect((item.wallet as IDataObject).provider).toBe('vodafone_cash');
		expect(item.envelope).toBeDefined();
		vi.useRealTimers();
	});

	it('answers 200 {"status":"ok"} itself in immediate mode and still starts the workflow', async () => {
		useFakeClock(valid.now);
		const { ctx, res } = context({ responseMode: 'onReceived' });
		const result = await trigger.webhook.call(ctx);
		expect(res.status).toHaveBeenCalledWith(200);
		expect(res.json).toHaveBeenCalledWith({ status: 'ok' });
		expect(result.noWebhookResponse).toBe(true);
		expect(result.workflowData?.[0]).toHaveLength(1);
		vi.useRealTimers();
	});

	it('answers 200 {"status":"ignored"} without starting the workflow for an unselected event', async () => {
		useFakeClock(valid.now);
		const { ctx, res } = context({ events: ['transfer.updated'] });
		const result = await trigger.webhook.call(ctx);
		expect(result).toEqual({ webhookResponse: { status: 'ignored' } });
		expect(res.status).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('keeps webhook.test deliveries flowing, marked as test, with the sample as the transfer', async () => {
		const testCase = cases.find((c) => c.name === 'valid_webhook_test')!;
		useFakeClock(testCase.now);
		const { ctx } = context({ body: testCase.body, headers: testCase.headers });
		const result = await trigger.webhook.call(ctx);
		const item = result.workflowData?.[0]?.[0]?.json as IDataObject;
		expect(item.test).toBe(true);
		expect((item.transfer as IDataObject).amount_minor).toBe(100);
		vi.useRealTimers();
	});

	it('answers 401 with a reason when the credential is missing or the raw body is unavailable', async () => {
		useFakeClock(valid.now);
		const noKey = context({ key: null });
		expect(await trigger.webhook.call(noKey.ctx)).toEqual({ noWebhookResponse: true });
		expect(noKey.res.status).toHaveBeenCalledWith(401);
		expect(noKey.res.json).toHaveBeenCalledWith({ error: 'invalid_signature', reason: 'no_key' });

		const noBody = context({ body: null });
		await trigger.webhook.call(noBody.ctx);
		expect(noBody.res.json).toHaveBeenCalledWith({ error: 'invalid_signature', reason: 'raw_body_unavailable' });
		vi.useRealTimers();
	});

	it('answers 400 for a signed body that is not a qersh.v1 envelope', async () => {
		// Sign a non-envelope body with the vector key so only the schema check can fail.
		const { createHmac } = await import('node:crypto');
		const body = '{"hello":"world"}';
		const t = 1791725802;
		const sig = createHmac('sha256', valid.secrets[0]!).update(`${t}.${body}`).digest('hex');
		useFakeClock(t + 5);
		const { ctx, res } = context({ body, headers: { ...valid.headers, 'X-Qersh-Signature': `t=${t},v1=${sig}` } });
		const result = await trigger.webhook.call(ctx);
		expect(result).toEqual({ noWebhookResponse: true });
		expect(res.status).toHaveBeenCalledWith(400);
		expect(res.json).toHaveBeenCalledWith({ error: 'bad_request', reason: 'not_qersh_v1' });
		vi.useRealTimers();
	});

	it('accepts a rotation header where only the previous key is configured', async () => {
		const rotation = cases.find((c) => c.name === 'rotation_previous_secret_still_valid')!;
		useFakeClock(rotation.now);
		const { ctx, res } = context({ body: rotation.body, headers: rotation.headers, key: rotation.secrets[0] });
		const result = await trigger.webhook.call(ctx);
		expect(result.workflowData).toBeDefined();
		expect(res.status).not.toHaveBeenCalled();
		vi.useRealTimers();
	});
});
