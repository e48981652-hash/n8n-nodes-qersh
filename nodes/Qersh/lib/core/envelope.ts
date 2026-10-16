// Generated from @qersh/webhook@0.1.0 (packages/qersh-webhook in the Qersh repository). Do not edit here:
// change the source, run `npm run export-core -- <this folder>`, and commit the new core.lock.json.
/**
 * The qersh.v1 envelope: parsing from the raw body (never from a re-serialised object) and the normalised item a
 * receiver hands to its workflow. Field names follow kit/webhook.v1.schema.json; readers ignore unknown fields.
 */
import { payerKeyOf } from './payer.js';

export interface QershWallet {
	id: string;
	provider: string;
	label?: string;
	number_masked: string;
	slot?: number | null;
}

export interface Counterparty {
	number?: string | null;
	name?: string | null;
	handle?: string | null;
	bank?: string | null;
}

export interface TransferChecks {
	balance_chain?: string;
	[key: string]: unknown;
}

/** `data` of transfer.received / transfer.sent / transfer.failed / transfer.reversed, and `data.sample` of webhook.test. */
export interface TransferData {
	transfer_id: string;
	direction: 'in' | 'out';
	status: string;
	amount?: string | null;
	amount_minor?: number | null;
	currency: string;
	balance_after?: string | null;
	balance_after_minor?: number | null;
	provider_txn_id?: string | null;
	provider_time_text?: string | null;
	received_at?: string;
	counterparty?: Counterparty | null;
	receiver_wallet_number?: string | null;
	channel?: string;
	checks?: TransferChecks;
	risk?: string;
	risk_reasons?: string[];
	auto_confirm_ok?: boolean;
	[key: string]: unknown;
}

/** `data` of transfer.updated: a later verdict on a transfer the receiver already has. */
export interface TransferUpdatedData {
	transfer_id: string;
	updated_fields?: string[];
	checks?: TransferChecks;
	risk?: string;
	risk_reasons?: string[];
	auto_confirm_ok?: boolean;
	[key: string]: unknown;
}

export interface QershEnvelope {
	schema: 'qersh.v1';
	event: string;
	delivery_id: string;
	created_at: string;
	created_at_epoch_ms?: number;
	test?: boolean;
	device?: Record<string, unknown>;
	wallet: QershWallet;
	subscription?: Record<string, unknown>;
	data: Record<string, unknown>;
}

export type ParseEnvelopeResult =
	| { ok: true; envelope: QershEnvelope }
	| { ok: false; reason: 'invalid_json' | 'not_an_object' | 'not_qersh_v1' };

const decoder = new TextDecoder('utf-8');

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Parses the raw body into an envelope. Call it only after the signature verified. Requires the fields every
 * qersh.v1 delivery carries (`schema`, `event`, `delivery_id`, `created_at`, `wallet`, `data`). Never throws.
 */
export function parseEnvelope(rawBody: Uint8Array | string | null | undefined): ParseEnvelopeResult {
	let text: string;
	if (typeof rawBody === 'string') text = rawBody;
	else if (rawBody instanceof Uint8Array) text = decoder.decode(rawBody);
	else return { ok: false, reason: 'invalid_json' };
	let value: unknown;
	try {
		value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
	} catch {
		return { ok: false, reason: 'invalid_json' };
	}
	if (!isRecord(value)) return { ok: false, reason: 'not_an_object' };
	const wallet = value['wallet'];
	if (
		value['schema'] !== 'qersh.v1' ||
		typeof value['event'] !== 'string' ||
		typeof value['delivery_id'] !== 'string' ||
		typeof value['created_at'] !== 'string' ||
		!isRecord(wallet) ||
		typeof wallet['id'] !== 'string' ||
		typeof wallet['provider'] !== 'string' ||
		!isRecord(value['data'])
	) {
		return { ok: false, reason: 'not_qersh_v1' };
	}
	return { ok: true, envelope: value as unknown as QershEnvelope };
}

/** The delivery headers a receiver keeps next to the body. */
export interface DeliveryHeaders {
	delivery: string | null;
	attempt: number | null;
	redelivery: 'manual' | 'backfill' | null;
	wallet: string | null;
	/** Unix seconds from the signature header, when known. */
	signature_t: number | null;
}

/** Reads the `X-Qersh-*` headers from any header object (names are matched case-insensitively). Never throws. */
export function deliveryHeaders(headers: Record<string, unknown> | null | undefined): DeliveryHeaders {
	const source = isRecord(headers) ? headers : {};
	const get = (name: string): string | null => {
		const direct = source[name] ?? source[name.toLowerCase()];
		const raw = direct ?? Object.entries(source).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
		if (Array.isArray(raw)) return typeof raw[0] === 'string' ? raw[0] : null;
		return typeof raw === 'string' ? raw : null;
	};
	const attemptText = get('x-qersh-attempt');
	const redelivery = get('x-qersh-redelivery');
	const signature = get('x-qersh-signature');
	const tMatch = signature ? /(?:^|,)\s*t=(\d+)\s*(?:,|$)/.exec(signature) : null;
	const tText = tMatch?.[1];
	return {
		delivery: get('x-qersh-delivery'),
		attempt: attemptText !== null && /^\d{1,9}$/.test(attemptText) ? Number(attemptText) : null,
		redelivery: redelivery === 'manual' || redelivery === 'backfill' ? redelivery : null,
		wallet: get('x-qersh-wallet'),
		signature_t: tText !== undefined && tText.length <= 13 ? Number(tText) : null,
	};
}

export interface PayerSummary {
	number: string | null;
	handle: string | null;
	name: string | null;
	/** Normalised matching key: the number when it normalises, else the handle; null when neither does. */
	key: string | null;
}

/** The part of a transfer a workflow usually needs, with the same names as the contract plus `payer.key` and `suspected_forgery`. */
export interface TransferSummary {
	transfer_id: string | null;
	direction: string | null;
	status: string | null;
	amount: string | null;
	amount_minor: number | null;
	currency: string | null;
	received_at: string | null;
	payer: PayerSummary;
	provider_txn_id: string | null;
	balance_after: string | null;
	risk: string | null;
	risk_reasons: string[];
	auto_confirm_ok: boolean | null;
	balance_chain: string | null;
	/** True when the balance check refuted the message: stop the order this transfer paid until a human checks the wallet. */
	suspected_forgery: boolean;
}

/** One item per delivery, as the n8n trigger emits it and as a generated receiver forwards it. */
export interface DeliveryItem {
	event: string;
	delivery_id: string;
	attempt: number | null;
	redelivery: 'manual' | 'backfill' | null;
	test: boolean;
	created_at: string;
	wallet: QershWallet;
	/** Present for transfer.* events and for webhook.test (from `data.sample`); null for other events. */
	transfer: TransferSummary | null;
	/** `data` exactly as it arrived. */
	data: Record<string, unknown>;
	/** The whole envelope exactly as it arrived. */
	envelope: QershEnvelope;
	/** The receiver's production URL, when the receiver knows it. Never contains a key. */
	webhook_url: string | null;
}

/** True when a transfer or an update carries the forgery verdict of the balance check. */
export function isSuspectedForgery(data: Record<string, unknown> | null | undefined): boolean {
	if (!isRecord(data)) return false;
	const reasons = Array.isArray(data['risk_reasons']) ? (data['risk_reasons'] as unknown[]) : [];
	const checks = isRecord(data['checks']) ? data['checks'] : undefined;
	return reasons.includes('suspected_forgery') || checks?.['balance_chain'] === 'refuted';
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const int = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

/** Summarises `data` of a transfer event, of webhook.test's sample, or of transfer.updated (then most fields are null). */
export function summarizeTransfer(data: Record<string, unknown> | null | undefined): TransferSummary | null {
	if (!isRecord(data)) return null;
	const cp = isRecord(data['counterparty']) ? (data['counterparty'] as Counterparty) : null;
	const checks = isRecord(data['checks']) ? data['checks'] : undefined;
	return {
		transfer_id: str(data['transfer_id']),
		direction: str(data['direction']),
		status: str(data['status']),
		amount: str(data['amount']),
		amount_minor: int(data['amount_minor']),
		currency: str(data['currency']),
		received_at: str(data['received_at']),
		payer: {
			number: str(cp?.number),
			handle: str(cp?.handle),
			name: str(cp?.name),
			key: payerKeyOf(cp),
		},
		provider_txn_id: str(data['provider_txn_id']),
		balance_after: str(data['balance_after']),
		risk: str(data['risk']),
		risk_reasons: Array.isArray(data['risk_reasons']) ? (data['risk_reasons'] as unknown[]).filter((r): r is string => typeof r === 'string') : [],
		auto_confirm_ok: bool(data['auto_confirm_ok']),
		balance_chain: str(checks?.['balance_chain']),
		suspected_forgery: isSuspectedForgery(data),
	};
}

/** Builds the normalised item from a parsed envelope. `webhookUrl` is the receiver's production URL (no key), or null. */
export function summarize(envelope: QershEnvelope, headers?: DeliveryHeaders | null, webhookUrl?: string | null): DeliveryItem {
	const event = typeof envelope.event === 'string' ? envelope.event : '';
	const data = isRecord(envelope.data) ? envelope.data : {};
	let transfer: TransferSummary | null = null;
	if (event.startsWith('transfer.')) transfer = summarizeTransfer(data);
	else if (event === 'webhook.test') {
		const sample = data['sample'];
		transfer = isRecord(sample) ? summarizeTransfer(sample) : null;
	}
	return {
		event,
		delivery_id: envelope.delivery_id,
		attempt: headers?.attempt ?? null,
		redelivery: headers?.redelivery ?? null,
		test: envelope.test === true || event === 'webhook.test',
		created_at: envelope.created_at,
		wallet: envelope.wallet,
		transfer,
		data,
		envelope,
		webhook_url: typeof webhookUrl === 'string' && webhookUrl.length > 0 ? webhookUrl : null,
	};
}
