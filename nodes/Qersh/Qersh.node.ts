import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { qershWebhookApiTest } from './credentialTest';
import { deliveryHeaders, parseEnvelope, summarize } from './lib/core/envelope';
import { judgeUpdate, matchTransfer, type CandidateOrder } from './lib/core/match';
import {
	buildSetupLink,
	SETUP_LINK_EVENTS,
	SETUP_LINK_PROVIDERS,
	validateSetupLink,
} from './lib/core/setup-link';
import { verifyQershDelivery } from './lib/node/index';

const PROVIDER_LABELS: Record<(typeof SETUP_LINK_PROVIDERS)[number], string> = {
	vodafone_cash: 'Vodafone Cash',
	etisalat_cash: 'e& money (Etisalat Cash)',
	orange_cash: 'Orange Cash',
	instapay_app: 'InstaPay App',
	bank_egbank: 'EG Bank SMS',
	bank_nbe: 'NBE SMS',
	bank_cib: 'CIB SMS',
	bank_kfh: 'KFH SMS',
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** A JSON-typed parameter arrives as an object or as a JSON string; anything unreadable becomes null. */
function readJson(value: unknown): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

export class Qersh implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Qersh',
		name: 'qersh',
		icon: { light: 'file:../../icons/qersh.svg', dark: 'file:../../icons/qersh.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description:
			'Verify a Qersh delivery received by the Webhook node, build the setup link for the Qersh app, or match a transfer to your open orders',
		defaults: { name: 'Qersh' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'qershWebhookApi',
				required: true,
				testedBy: 'qershWebhookApiTest',
				displayOptions: { show: { operation: ['verifyDelivery'] } },
			},
			{
				name: 'qershWebhookApi',
				required: true,
				testedBy: 'qershWebhookApiTest',
				displayOptions: { show: { operation: ['buildSetupLink'], includeConnectionKey: [true] } },
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Verify Delivery',
						value: 'verifyDelivery',
						action: 'Verify a delivery received by the webhook node',
						description:
							'Checks X-Qersh-Signature on the raw body captured by the Webhook node (Raw Body option on) and emits the normalised delivery with a verification field',
					},
					{
						name: 'Build Setup Link',
						value: 'buildSetupLink',
						action: 'Build the setup link for the phone app',
						description:
							'Builds the qersh://setup link the merchant pastes into "Add wallet"; without the key by default, so the phone generates it',
					},
					{
						name: 'Match Transfer',
						value: 'matchTransfer',
						action: 'Match a transfer to open orders',
						description:
							'Finds the order a transfer paid, by payer and by the time the money arrived, and returns the reply for the phone',
					},
				],
				default: 'verifyDelivery',
			},

			// ── Verify Delivery ──────────────────────────────────────────────────────────────
			{
				displayName: 'Signature Header',
				name: 'signatureHeader',
				type: 'string',
				default: '={{ $json.headers["x-qersh-signature"] }}',
				required: true,
				description: 'The X-Qersh-Signature header of the request, as the Webhook node outputs it',
				displayOptions: { show: { operation: ['verifyDelivery'] } },
			},
			{
				displayName: 'Raw Body Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				required: true,
				description:
					'Name of the binary field holding the raw request body. The Webhook node writes it to "data" when its Raw Body option is on.',
				displayOptions: { show: { operation: ['verifyDelivery'] } },
			},
			{
				displayName: 'Request Headers',
				name: 'requestHeaders',
				type: 'json',
				default: '={{ $json.headers }}',
				description:
					'All request headers, used to read the delivery ID, attempt and redelivery marker',
				displayOptions: { show: { operation: ['verifyDelivery'] } },
			},

			// ── Build Setup Link ─────────────────────────────────────────────────────────────
			{
				displayName: 'Webhook URL',
				name: 'webhookUrl',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. https://your-n8n.example.com/webhook/qersh',
				description:
					'The Production URL shown in the Qersh Trigger node. HTTPS, or HTTP only for a local address.',
				displayOptions: { show: { operation: ['buildSetupLink'] } },
			},
			{
				displayName: 'Wallet Label',
				name: 'label',
				type: 'string',
				default: '',
				placeholder: 'e.g. Shop wallet',
				description: 'Shown in the app as the wallet name; cut to 60 characters',
				displayOptions: { show: { operation: ['buildSetupLink'] } },
			},
			{
				displayName: 'Wallet Type',
				name: 'provider',
				type: 'options',
				options: [
					{ name: 'Not Set (Merchant Chooses)', value: '' },
					...SETUP_LINK_PROVIDERS.map((id) => ({ name: PROVIDER_LABELS[id], value: id })),
				],
				default: '',
				description: 'Pre-selects the wallet type in the app',
				displayOptions: { show: { operation: ['buildSetupLink'] } },
			},
			{
				displayName: 'Events',
				name: 'linkEvents',
				type: 'multiOptions',
				options: SETUP_LINK_EVENTS.map((e) => ({ name: e, value: e })),
				default: [],
				description:
					'Leave empty to keep the app defaults. Listing events switches off every event that is not listed.',
				displayOptions: { show: { operation: ['buildSetupLink'] } },
			},
			{
				displayName: 'Include Connection Key',
				name: 'includeConnectionKey',
				type: 'boolean',
				default: false,
				description:
					'Whether to put the connection key from the credential into the link. Off: the phone generates the key and the merchant sends it to you. On: the key is written into this execution.',
				displayOptions: { show: { operation: ['buildSetupLink'] } },
			},
			{
				displayName:
					'The link will contain the connection key. Run this once by hand, send the link to the merchant only, and do not keep or share the execution.',
				name: 'keyNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { operation: ['buildSetupLink'], includeConnectionKey: [true] } },
			},

			// ── Match Transfer ───────────────────────────────────────────────────────────────
			{
				displayName: 'Transfer',
				name: 'transfer',
				type: 'json',
				default: '={{ $json.transfer }}',
				required: true,
				description:
					'The transfer object from the Qersh Trigger item (or the data object of a transfer.received delivery)',
				displayOptions: { show: { operation: ['matchTransfer'] } },
			},
			{
				displayName: 'Candidate Orders',
				name: 'orders',
				type: 'json',
				default: '[]',
				required: true,
				description:
					'JSON array of the open orders to match against: order_number, price_minor, paid_minor, payer_key, created_at, expires_at (ISO-8601 or epoch milliseconds). The node keeps only the orders of this payer that were open when the money arrived.',
				displayOptions: { show: { operation: ['matchTransfer'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				displayOptions: { show: { operation: ['matchTransfer'] } },
				options: [
					{
						displayName: 'Late Window (Minutes)',
						name: 'lateWindowMinutes',
						type: 'number',
						default: 120,
						description:
							'An order that expired this many minutes before the money arrived still accepts it',
					},
					{
						displayName: 'Clock Skew (Minutes)',
						name: 'skewMinutes',
						type: 'number',
						default: 10,
						description:
							'An order created up to this many minutes after the money arrived still counts, for clock differences between the phone and your store',
					},
				],
			},
		],
	};

	methods = {
		credentialTest: { qershWebhookApiTest },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				if (operation === 'verifyDelivery') {
					returnData.push({ json: await verifyDelivery.call(this, i), pairedItem: { item: i } });
				} else if (operation === 'buildSetupLink') {
					returnData.push({ json: await setupLink.call(this, i), pairedItem: { item: i } });
				} else if (operation === 'matchTransfer') {
					returnData.push({ json: match.call(this, i), pairedItem: { item: i } });
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, { itemIndex: i });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}
		return [returnData];
	}
}

async function verifyDelivery(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const credential = await this.getCredentials('qershWebhookApi', i);
	const key = typeof credential.connectionSecret === 'string' ? credential.connectionSecret.trim() : '';
	const header = this.getNodeParameter('signatureHeader', i, '') as unknown;
	const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
	const headersParam = readJson(this.getNodeParameter('requestHeaders', i, {}));
	const headers = isRecord(headersParam) ? headersParam : {};

	let rawBody: Buffer | null = null;
	try {
		rawBody = await this.helpers.getBinaryDataBuffer(i, binaryPropertyName);
	} catch {
		rawBody = null;
	}

	const verdict = verifyQershDelivery({ header, rawBody, keys: key ? [key] : [] });
	if (!verdict.ok) {
		const hint =
			verdict.reason === 'raw_body_unavailable'
				? 'Turn on the Raw Body option of the Webhook node so the exact bytes are available'
				: undefined;
		return { verification: { valid: false, reason: verdict.reason, hint } };
	}
	const parsed = parseEnvelope(rawBody as Buffer);
	if (!parsed.ok) {
		return { verification: { valid: false, reason: parsed.reason } };
	}
	const item = summarize(parsed.envelope, deliveryHeaders(headers), null);
	return { ...(item as unknown as IDataObject), verification: { valid: true, key_index: verdict.keyIndex } };
}

async function setupLink(this: IExecuteFunctions, i: number): Promise<IDataObject> {
	const webhookUrl = (this.getNodeParameter('webhookUrl', i, '') as string).trim();
	const label = this.getNodeParameter('label', i, '') as string;
	const provider = this.getNodeParameter('provider', i, '') as string;
	const events = this.getNodeParameter('linkEvents', i, []) as string[];
	const includeKey = this.getNodeParameter('includeConnectionKey', i, false) as boolean;

	let secret: string | null = null;
	if (includeKey) {
		const credential = await this.getCredentials('qershWebhookApi', i);
		secret = typeof credential.connectionSecret === 'string' ? credential.connectionSecret.trim() : null;
		if (!secret) {
			throw new NodeOperationError(this.getNode(), 'Select a Qersh Webhook API credential with a connection key, or turn off "Include Connection Key"', { itemIndex: i });
		}
	}

	const params = { url: webhookUrl, secret, label, provider, events };
	const check = validateSetupLink(params);
	if (!check.ok) {
		const detail = check.detail ? ` (${check.detail})` : '';
		throw new NodeOperationError(this.getNode(), `The setup link cannot be built: ${check.problem}${detail}`, {
			itemIndex: i,
			description:
				'The URL must be HTTPS (or HTTP for a local address) without user info and under 2048 characters; events must be ones the app knows; a key must be at least 24 characters without spaces.',
		});
	}
	return {
		setup_url: buildSetupLink(params),
		webhook_url: webhookUrl,
		label: label.trim().slice(0, 60) || null,
		provider: provider || null,
		events: events.length > 0 ? events : null,
		includes_key: includeKey,
		warnings: check.warnings,
	};
}

function match(this: IExecuteFunctions, i: number): IDataObject {
	const transfer = readJson(this.getNodeParameter('transfer', i, {}));
	const ordersRaw = readJson(this.getNodeParameter('orders', i, []));
	const options = this.getNodeParameter('options', i, {}) as { lateWindowMinutes?: number; skewMinutes?: number };
	if (!isRecord(transfer)) {
		throw new NodeOperationError(this.getNode(), 'Transfer must be a JSON object (the transfer field of a Qersh Trigger item)', { itemIndex: i });
	}
	const isUpdate =
		Array.isArray(transfer.updated_fields) ||
		(typeof transfer.event === 'string' && transfer.event === 'transfer.updated');
	if (isUpdate) {
		return judgeUpdate(transfer) as unknown as IDataObject;
	}
	if (!Array.isArray(ordersRaw)) {
		throw new NodeOperationError(this.getNode(), 'Candidate Orders must be a JSON array', { itemIndex: i });
	}
	const orders = ordersRaw.filter(isRecord) as unknown as CandidateOrder[];
	const result = matchTransfer(transfer, orders, {
		late_window_min: options.lateWindowMinutes,
		skew_min: options.skewMinutes,
	});
	return result as unknown as IDataObject;
}
