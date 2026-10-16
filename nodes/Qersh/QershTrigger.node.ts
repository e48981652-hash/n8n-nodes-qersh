import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { qershWebhookApiTest } from './credentialTest';
import { QERSH_EVENTS } from './lib/core/config';
import { deliveryHeaders, parseEnvelope, summarize } from './lib/core/envelope';
import { verifyQershDelivery } from './lib/node/index';

const EVENT_OPTIONS: Array<{ name: string; value: string; description: string }> = [
	{ name: 'Transfer Received', value: 'transfer.received', description: 'Money arrived in the wallet (the main event)' },
	{ name: 'Transfer Updated', value: 'transfer.updated', description: 'A later verdict on a transfer you already received; may carry suspected_forgery' },
	{ name: 'Webhook Test', value: 'webhook.test', description: 'Sent by "Test connection" in the app; its sample transfer is marked test' },
	{ name: 'Transfer Sent', value: 'transfer.sent', description: 'Money left the wallet' },
	{ name: 'Transfer Failed', value: 'transfer.failed', description: 'A transfer the wallet reported as failed' },
	{ name: 'Transfer Reversed', value: 'transfer.reversed', description: 'A transfer the wallet reported as reversed' },
	{ name: 'Message Unparsed', value: 'message.unparsed', description: 'A wallet message no template understood (fields only, never the text)' },
	{ name: 'Device Heartbeat', value: 'device.heartbeat', description: 'Health of the phone and the wallet, every 15 minutes' },
	{ name: 'Subscription Limit Reached', value: 'subscription.limit_reached', description: 'The wallet crossed its monthly limit' },
];

export class QershTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Qersh Trigger',
		name: 'qershTrigger',
		icon: { light: 'file:../../icons/qersh.svg', dark: 'file:../../icons/qersh.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description:
			'Starts the workflow when the Qersh app on the merchant phone reports a wallet transfer',
		defaults: { name: 'Qersh Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'qershWebhookApi', required: true, testedBy: 'qershWebhookApiTest' }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				path: '={{$parameter["path"]}}',
				isFullPath: true,
				responseMode: '={{$parameter["responseMode"]}}',
				responseData: 'firstEntryJson',
			},
		],
		triggerPanel: {
			header:
				'Qersh posts every delivery of one wallet to the URL below. Paste the Production URL into the Qersh app as the store URL; the phone then generates the connection key for the credential.',
			executionsHelp: {
				inactive:
					'Webhooks have two modes: test and production. <br /><br /><b>Use test mode while you build your workflow</b>. Click "Listen for test event", then tap "Test connection" in the Qersh app (the test URL accepts one request per click). The execution shows up in the editor.<br /><br /><b>Use production mode to run your workflow automatically</b>. <a data-key="activate">Activate</a> the workflow, then let the phone send to the production URL. These executions show up in the executions list, but not in the editor.',
				active:
					'Webhooks have two modes: test and production. <br /><br /><b>Use test mode while you build your workflow</b>. Click "Listen for test event", then tap "Test connection" in the Qersh app. The execution shows up in the editor.<br /><br /><b>Your workflow is active</b>. Deliveries to the production URL run it automatically and show up in the <a data-key="executions">executions list</a>.',
			},
			activationHint:
				'Once your workflow is active, the Qersh app sends to the production URL without this button.',
		},
		activationMessage:
			'Your workflow is now active. If the Qersh app does not have the production URL yet, paste it there as the store URL.',
		properties: [
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: 'qersh',
				required: true,
				placeholder: 'qersh',
				description:
					'The last part of the webhook URL, e.g. https://your-n8n/webhook/qersh. Give every wallet its own path.',
			},
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['transfer.received', 'transfer.updated', 'webhook.test'],
				options: EVENT_OPTIONS,
				description:
					'Deliveries of other events are answered with 200 {"status":"ignored"} and do not start the workflow',
			},
			{
				displayName: 'Respond',
				name: 'responseMode',
				type: 'options',
				options: [
					{
						name: 'When Last Node Finishes',
						value: 'lastNode',
						description:
							'Replies with the JSON of the first item of the last node. A failed execution becomes a 500, so the phone retries the same delivery and alerts the merchant. Finish within 10 seconds and end every branch with a single-output node such as Set.',
					},
					{
						name: 'Immediately',
						value: 'onReceived',
						description:
							'Replies 200 {"status":"ok"} before the workflow runs. Use it for long workflows; a failed execution then stays in the executions list and the phone does not retry.',
					},
				],
				default: 'lastNode',
				description: 'When and with what the delivery is answered',
			},
			{
				displayName:
					'Copy the Production URL above into the Qersh app as the store URL (More, Wallets, Add wallet), let the phone generate the connection key, paste that key into the Qersh Webhook API credential, then tap "Test connection" on the phone. <a href="https://qersh.cfd/en/integrations/n8n" target="_blank">Step-by-step guide</a>.',
				name: 'setupNotice',
				type: 'notice',
				default: '',
			},
		],
	};

	methods = {
		credentialTest: { qershWebhookApiTest },
	};

	// Qersh has no API: the merchant registers the URL on the phone, so there is nothing to create or delete here.
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject() as unknown as { rawBody?: Buffer | string };
		const res = this.getResponseObject();
		const headers = this.getHeaderData() as unknown as Record<string, unknown>;
		const answer = (status: number, body: IDataObject): IWebhookResponseData => {
			res.status(status).json(body);
			return { noWebhookResponse: true };
		};

		let key = '';
		try {
			const credential = await this.getCredentials('qershWebhookApi');
			key = typeof credential.connectionSecret === 'string' ? credential.connectionSecret.trim() : '';
		} catch {
			key = '';
		}

		const rawBody = req.rawBody;
		const verdict = verifyQershDelivery({
			header: headers['x-qersh-signature'],
			rawBody,
			keys: key ? [key] : [],
		});
		if (!verdict.ok) {
			return answer(401, { error: 'invalid_signature', reason: verdict.reason });
		}

		const parsed = parseEnvelope(rawBody as Buffer | string);
		if (!parsed.ok) {
			return answer(400, { error: 'bad_request', reason: parsed.reason });
		}

		const events = this.getNodeParameter('events', []) as string[];
		const known = (QERSH_EVENTS as readonly string[]).includes(parsed.envelope.event);
		if (!events.includes(parsed.envelope.event) || !known) {
			return { webhookResponse: { status: 'ignored' } };
		}

		const item = summarize(
			parsed.envelope,
			deliveryHeaders(headers),
			this.getNodeWebhookUrl('default') ?? null,
		);
		const workflowData = [this.helpers.returnJsonArray([item as unknown as IDataObject])];

		const mode = this.getNodeParameter('responseMode', 'lastNode') as string;
		if (mode === 'onReceived') {
			res.status(200).json({ status: 'ok' });
			return { noWebhookResponse: true, workflowData };
		}
		return { workflowData };
	}
}
