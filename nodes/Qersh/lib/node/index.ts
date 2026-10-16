// Generated from @qersh/webhook@0.1.0 (packages/qersh-webhook in the Qersh repository). Do not edit here:
// change the source, run `npm run export-core -- <this folder>`, and commit the new core.lock.json.
/**
 * Node adapter: node:crypto primitives for the core, plus the one-call verifier a Node receiver (or the n8n node) uses.
 * The only import outside the core is `node:crypto`, which n8n allows in community nodes.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { verifySignature, type SyncHmac, type VerifyResult } from '../core/signature.js';
import { verifyStandardWebhooks, type StandardWebhooksResult } from '../core/standard-webhooks.js';

export const nodeHmac: SyncHmac = {
	hmacSha256Hex: (key, data) => createHmac('sha256', key).update(data).digest('hex'),
	equalHex: (a, b) => {
		if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b) || a.length !== b.length) return false;
		const x = Buffer.from(a, 'hex');
		const y = Buffer.from(b, 'hex');
		return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
	},
};

/** Turns whatever a framework hands over as the raw body into bytes; null when there is no raw body. */
export function toBytes(body: Buffer | Uint8Array | string | null | undefined): Uint8Array | null {
	if (body === null || body === undefined) return null;
	if (typeof body === 'string') return new TextEncoder().encode(body);
	if (body instanceof Uint8Array) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
	return null;
}

export interface VerifyDeliveryArgs {
	/** `X-Qersh-Signature` header value. */
	header: unknown;
	/** The body exactly as received. */
	rawBody: Buffer | Uint8Array | string | null | undefined;
	/** Connection keys, current first. */
	keys: readonly string[];
	/** Unix seconds; defaults to the current time. */
	now?: number;
	toleranceSec?: number;
}

/** Verifies `X-Qersh-Signature` with node:crypto. Never throws. */
export function verifyQershDelivery(args: VerifyDeliveryArgs): VerifyResult {
	return verifySignature(
		{ header: args.header, rawBody: toBytes(args.rawBody), keys: args.keys, now: args.now ?? Math.floor(Date.now() / 1000), toleranceSec: args.toleranceSec },
		nodeHmac,
	);
}

/** Verifies the Standard Webhooks headers with node:crypto. Never throws. */
export function verifyStandardWebhooksDelivery(args: { id: unknown; timestamp: unknown; signature: unknown; rawBody: Buffer | Uint8Array | string | null | undefined; keys: readonly string[]; now?: number; toleranceSec?: number }): StandardWebhooksResult {
	return verifyStandardWebhooks(
		{ id: args.id, timestamp: args.timestamp, signature: args.signature, rawBody: toBytes(args.rawBody), keys: args.keys, now: args.now ?? Math.floor(Date.now() / 1000), toleranceSec: args.toleranceSec },
		nodeHmac,
	);
}
