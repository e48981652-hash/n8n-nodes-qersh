// Generated from @qersh/webhook@0.1.0 (packages/qersh-webhook in the Qersh repository). Do not edit here:
// change the source, run `npm run export-core -- <this folder>`, and commit the new core.lock.json.
/**
 * The one declared configuration of a Qersh receiver.
 *
 * Every receiver built from this core (the n8n node, a generated Docker/ISO receiver, a script) reads exactly
 * these fields and nothing else, so a website configurator can produce a complete receiver from one filled form.
 * Values that the qersh.v1 contract fixes (the 300-second window, the 10-second reply) are here with their
 * contract defaults and should only be changed knowingly.
 */

/** Every event name the phone can send (kit/webhook.v1.schema.json, `eventName`). */
export const QERSH_EVENTS = [
	'transfer.received',
	'transfer.sent',
	'transfer.failed',
	'transfer.reversed',
	'transfer.updated',
	'message.unparsed',
	'device.heartbeat',
	'webhook.test',
	'subscription.limit_reached',
] as const;

export type QershEvent = (typeof QERSH_EVENTS)[number];

export interface QershReceiverConfig {
	/** Where the phone posts. `path` is relative to the receiver's public base URL (no leading slash). */
	endpoint: { path: string };
	/**
	 * Connection keys whose signatures are accepted, current key first. During a rotation the phone signs with every
	 * live key, so one correct key is enough; a second entry only bridges a receiver that was given the new key before
	 * the phone was.
	 */
	keys: string[];
	/** Largest accepted |now − t| in seconds. The contract says 300. */
	tolerance_sec: number;
	/** Events the receiver processes. Any other event is answered 2xx with `{"status":"ignored"}` and dropped. */
	events: QershEvent[];
	matching: {
		/** An order that expired this many minutes before the money arrived still accepts it (contract: 120). */
		late_window_min: number;
		/** The phone's clock and the receiver's may differ by this many minutes (contract: 10). */
		skew_min: number;
	};
	dedup: {
		/** How long delivery ids are remembered so a repeated delivery gets the same reply (contract: at least 180). */
		keep_days: number;
	};
}

export const defaultConfig: QershReceiverConfig = {
	endpoint: { path: 'qersh' },
	keys: [],
	tolerance_sec: 300,
	events: ['transfer.received', 'transfer.updated', 'webhook.test'],
	matching: { late_window_min: 120, skew_min: 10 },
	dedup: { keep_days: 180 },
};

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

/**
 * A partial config (for example from a form) completed with the contract defaults. Arrays are copied, keys are
 * trimmed (the phone trims a key before storing and signing with it) and empty keys dropped.
 */
export function withDefaults(partial: Partial<QershReceiverConfig> | null | undefined): QershReceiverConfig {
	const p = partial ?? {};
	const keys = p.keys === undefined ? defaultConfig.keys : stringList(p.keys);
	const events = p.events === undefined ? defaultConfig.events : stringList(p.events);
	return {
		endpoint: { path: typeof p.endpoint?.path === 'string' ? p.endpoint.path : defaultConfig.endpoint.path },
		keys: keys.map((k) => k.trim()).filter((k) => k.length > 0),
		tolerance_sec: p.tolerance_sec ?? defaultConfig.tolerance_sec,
		events: [...events] as QershEvent[],
		matching: {
			late_window_min: p.matching?.late_window_min ?? defaultConfig.matching.late_window_min,
			skew_min: p.matching?.skew_min ?? defaultConfig.matching.skew_min,
		},
		dedup: { keep_days: p.dedup?.keep_days ?? defaultConfig.dedup.keep_days },
	};
}

export interface ConfigIssue {
	/** JSON-pointer-like path of the offending field, e.g. `keys[0]`. */
	path: string;
	message: string;
}

const isEvent = (value: unknown): value is QershEvent =>
	typeof value === 'string' && (QERSH_EVENTS as readonly string[]).includes(value);

/** Reports everything wrong with a config object. An empty array means the config is usable. Never throws. */
export function validateConfig(config: unknown): ConfigIssue[] {
	const issues: ConfigIssue[] = [];
	if (typeof config !== 'object' || config === null) return [{ path: '', message: 'config must be an object' }];
	const c = config as Record<string, unknown>;

	const endpoint = c['endpoint'];
	const path = typeof endpoint === 'object' && endpoint !== null ? (endpoint as Record<string, unknown>)['path'] : undefined;
	if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') || /\s/.test(path)) {
		issues.push({ path: 'endpoint.path', message: 'a non-empty path without a leading slash or white space' });
	}

	const keys = c['keys'];
	if (!Array.isArray(keys) || keys.length === 0) issues.push({ path: 'keys', message: 'at least one connection key' });
	else {
		keys.forEach((key, i) => {
			if (!isAcceptableKey(key)) issues.push({ path: `keys[${i}]`, message: 'at least 24 characters and no white space' });
		});
	}

	const tolerance = c['tolerance_sec'];
	if (!Number.isInteger(tolerance) || (tolerance as number) < 1 || (tolerance as number) > 3600) {
		issues.push({ path: 'tolerance_sec', message: 'an integer number of seconds between 1 and 3600 (the contract uses 300)' });
	}

	const events = c['events'];
	if (!Array.isArray(events) || events.length === 0) issues.push({ path: 'events', message: 'a non-empty array of event names' });
	else events.forEach((e, i) => { if (!isEvent(e)) issues.push({ path: `events[${i}]`, message: `unknown event; one of ${QERSH_EVENTS.join(', ')}` }); });

	const matching = (typeof c['matching'] === 'object' && c['matching'] !== null ? c['matching'] : {}) as Record<string, unknown>;
	if (!Number.isInteger(matching['late_window_min']) || (matching['late_window_min'] as number) < 0) issues.push({ path: 'matching.late_window_min', message: 'a non-negative integer number of minutes' });
	if (!Number.isInteger(matching['skew_min']) || (matching['skew_min'] as number) < 0) issues.push({ path: 'matching.skew_min', message: 'a non-negative integer number of minutes' });

	const dedup = (typeof c['dedup'] === 'object' && c['dedup'] !== null ? c['dedup'] : {}) as Record<string, unknown>;
	if (!Number.isInteger(dedup['keep_days']) || (dedup['keep_days'] as number) < 1) issues.push({ path: 'dedup.keep_days', message: 'a positive integer number of days (the contract asks for at least 180)' });

	return issues;
}

/**
 * The rule the Qersh app applies to a connection key typed or pasted into it (`WebhookSigner.isAcceptableSecret`):
 * at least 24 characters once trimmed and no white space. Keys the app generates look like `qsk_` plus 43 URL-safe
 * characters, but a merchant may use a key of their own. A key inside a setup link follows the stricter rule of the
 * link reader (see `isUsableSecret` in setup-link.ts).
 */
export function isAcceptableKey(key: unknown): key is string {
	if (typeof key !== 'string') return false;
	const s = key.trim();
	return s.length >= 24 && !/\s/.test(s);
}

/** JSON Schema (draft 2020-12) of {@link QershReceiverConfig}, for forms, generators and validation tools. */
export const configJsonSchema = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	$id: 'urn:qersh:receiver-config:1',
	title: 'Qersh receiver configuration',
	type: 'object',
	required: ['endpoint', 'keys', 'tolerance_sec', 'events', 'matching', 'dedup'],
	additionalProperties: false,
	properties: {
		endpoint: {
			type: 'object',
			required: ['path'],
			additionalProperties: false,
			properties: { path: { type: 'string', minLength: 1, pattern: '^[^/\\s][^\\s]*$', default: 'qersh' } },
		},
		keys: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^\\S{24,}$' }, description: 'Connection keys, current first' },
		tolerance_sec: { type: 'integer', minimum: 1, maximum: 3600, default: 300 },
		events: { type: 'array', minItems: 1, items: { type: 'string', enum: [...QERSH_EVENTS] }, default: [...defaultConfig.events] },
		matching: {
			type: 'object',
			required: ['late_window_min', 'skew_min'],
			additionalProperties: false,
			properties: {
				late_window_min: { type: 'integer', minimum: 0, default: 120 },
				skew_min: { type: 'integer', minimum: 0, default: 10 },
			},
		},
		dedup: {
			type: 'object',
			required: ['keep_days'],
			additionalProperties: false,
			properties: { keep_days: { type: 'integer', minimum: 1, default: 180 } },
		},
	},
} as const;
