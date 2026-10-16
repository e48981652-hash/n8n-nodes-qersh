// Clean-install check of the PUBLISHED package on a fresh self-hosted n8n, the way a merchant would install it:
// owner setup, install @qersh-pay/n8n-nodes-qersh@<version> from npm through n8n's own community-packages API,
// credential from the kit's TEST vectors, import both T3 templates pointed at the fake store (e2e/fake-store.mjs),
// activate them, send the kit's probes with e2e/send.mjs, and check the replies and the store calls.
//
// Needs a running n8n with N8N_UNVERIFIED_PACKAGES_ENABLED=true and NODE_FUNCTION_ALLOW_BUILTIN=crypto, and the fake
// store. Usage: node e2e/clean-install.mjs [version]   env: N8N_BASE (http://localhost:5680), STORE_BASE
// (http://127.0.0.1:8788), ONLY=t3,t3nn, INSTALL_ATTEMPTS (10: the registry can lag a few minutes after a publish).
// Exits non-zero on the first failed expectation. Nothing here is part of the published package.
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const PACKAGE = pkg.name;
const VERSION = process.argv[2] ?? pkg.version;
const BASE = process.env.N8N_BASE ?? 'http://localhost:5680';
const STORE = process.env.STORE_BASE ?? 'http://127.0.0.1:8788';
const INSTALL_ATTEMPTS = Number(process.env.INSTALL_ATTEMPTS ?? 10);
const TEST_KEY = JSON.parse(readFileSync(path.join(root, 'fixtures', 'test-vectors.json'), 'utf8')).secret;
const owner = { email: 'clean-owner@qersh.test', firstName: 'Qersh', lastName: 'Clean', password: 'Clean-' + randomBytes(12).toString('base64url') + '1a' };

let failures = 0;
const fail = (msg) => { failures++; console.log('FAIL ' + msg); };
const short = (x, n = 300) => (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cookie = '';
const api = async (method, p, body) => {
	const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
	const setCookie = res.headers.get('set-cookie');
	if (setCookie) cookie = setCookie.split(';')[0];
	const text = await res.text();
	let data = text;
	try { data = JSON.parse(text); } catch {}
	return { status: res.status, data };
};

// 0) wait until the REST API answers with JSON: while migrations run, every call gets "n8n is starting up. Please wait"
let r;
for (let i = 0; ; i++) {
	r = await api('GET', '/rest/settings').catch(() => ({ status: 0, data: '' }));
	// before login only the public settings object comes back (settingsMode, no versionCli); any JSON means the routes are mounted
	if (r.status === 200 && typeof r.data === 'object' && r.data?.data?.settingsMode) break;
	if (i === 120) { console.log('n8n never became ready:', r.status, short(r.data, 120)); process.exit(1); }
	if (i % 6 === 0) console.log('waiting for n8n:', r.status, short(r.data, 60));
	await sleep(5_000);
}

// 1) owner (fresh instance) or login (re-run)
r = await api('POST', '/rest/owner/setup', owner);
if (r.status === 200) console.log('owner created');
else {
	r = await api('POST', '/rest/login', { emailOrLdapLoginId: owner.email, password: owner.password });
	if (r.status !== 200) { console.log('owner setup and login both failed', r.status, short(r.data)); process.exit(1); }
	console.log('logged in as existing owner');
}

// instance facts
r = await api('GET', '/rest/settings');
const settings = r.data?.data ?? {};
console.log('n8n', settings.versionCli, 'communityNodesEnabled=' + settings.communityNodesEnabled, 'unverifiedCommunityNodesEnabled=' + settings.unverifiedCommunityNodesEnabled);

// 2) install the published package through n8n (retry: the registry can take minutes to serve a fresh version)
const listInstalled = async () => {
	const res = await api('GET', '/rest/community-packages');
	if (!Array.isArray(res.data?.data)) console.log('GET /rest/community-packages ->', res.status, short(res.data, 200));
	return res.data?.data ?? [];
};
let installed = await listInstalled();
if (installed.some((p) => p.packageName === PACKAGE && p.installedVersion === VERSION)) console.log(`${PACKAGE}@${VERSION} already installed`);
else {
	for (let attempt = 1; attempt <= INSTALL_ATTEMPTS; attempt++) {
		const t0 = Date.now();
		r = await api('POST', '/rest/community-packages', { name: PACKAGE, version: VERSION });
		console.log(`install ${PACKAGE}@${VERSION} attempt ${attempt} -> ${r.status} in ${Math.round((Date.now() - t0) / 1000)}s: ${short(r.data, 400)}`);
		if (r.status === 200) break;
		if (attempt === INSTALL_ATTEMPTS) process.exit(1);
		await sleep(30_000);
	}
}
for (let i = 0; i < 12; i++) {
	installed = await listInstalled();
	if (installed.some((p) => p.packageName === PACKAGE)) break;
	await sleep(5_000);
}
console.log('installed packages:', installed.map((p) => `${p.packageName}@${p.installedVersion} nodes=${(p.installedNodes ?? []).map((n) => n.type).join(',')}`).join(' ; ') || 'none');

// 3) the two node types must be loaded
r = await api('GET', '/types/nodes.json');
const types = Array.isArray(r.data) ? r.data : [];
const qersh = types.filter((t) => t.name.startsWith(PACKAGE + '.'));
console.log('qersh node types:', qersh.map((t) => `${t.name} v${t.version} "${t.displayName}"`).join(' ; ') || 'NONE');
// n8n adds a generated "<Node> Tool" type for every node with usableAsTool, so more than two is fine
for (const want of ['qershTrigger', 'qersh']) {
	if (!qersh.some((t) => t.name === `${PACKAGE}.${want}`)) fail(`node type ${PACKAGE}.${want} is missing`);
}
if (failures) process.exit(1);

// 4) credential with the kit's TEST key
r = await api('GET', '/rest/credentials');
let credential = (r.data?.data ?? []).find((c) => c.type === 'qershWebhookApi' && c.name === 'Qersh test key');
if (!credential) {
	r = await api('POST', '/rest/credentials', { name: 'Qersh test key', type: 'qershWebhookApi', data: { connectionSecret: TEST_KEY } });
	if (r.status !== 200) { console.log('credential create failed', r.status, short(r.data)); process.exit(1); }
	credential = r.data.data ?? r.data;
}
console.log('credential id', credential.id);

// 5) import and activate both T3 templates
const files = [
	['t3', 't3-confirm-store-orders-from-wallet-transfers.json'],
	['t3nn', 't3-confirm-store-orders-from-wallet-transfers.webhook-code.json'],
];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const selected = files.filter(([slug]) => !only || only.includes(slug));
r = await api('GET', '/rest/workflows');
const existing = r.data?.data ?? [];
for (const [slug, file] of selected) {
	const wf = JSON.parse(readFileSync(path.join(root, 'templates', file), 'utf8'));
	wf.name = 'clean ' + slug;
	for (const n of wf.nodes) {
		if (n.type === PACKAGE + '.qershTrigger') {
			n.parameters.path = slug;
			n.credentials = { qershWebhookApi: { id: credential.id, name: credential.name } };
		}
		if (n.type === 'n8n-nodes-base.webhook') n.parameters.path = slug;
		if (n.name === 'Settings') {
			for (const a of n.parameters.assignments.assignments) {
				if (a.name === 'connection_key') a.value = TEST_KEY;
				if (a.name === 'store_base_url') a.value = STORE;
			}
		}
	}
	const payload = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings, active: false };
	let id;
	const old = existing.find((w) => w.name === wf.name);
	if (old) {
		const full = (await api('GET', `/rest/workflows/${old.id}`)).data.data;
		if (full.active) await api('POST', `/rest/workflows/${old.id}/deactivate`, {});
		r = await api('PATCH', `/rest/workflows/${old.id}`, { ...payload, versionId: full.versionId });
		id = old.id;
	} else {
		r = await api('POST', '/rest/workflows', payload);
		id = r.data?.data?.id ?? r.data?.id;
	}
	if (r.status !== 200) { fail(`${slug} import -> ${r.status} ${short(r.data, 500)}`); continue; }
	const full = (await api('GET', `/rest/workflows/${id}`)).data.data;
	const act = await api('POST', `/rest/workflows/${id}/activate`, { versionId: full.versionId });
	const activeNow = (await api('GET', `/rest/workflows/${id}`)).data.data.active;
	console.log(`${slug}: imported (${wf.nodes.length} nodes) activate=${act.status} active=${activeNow}${act.status !== 200 ? ' ' + short(act.data) : ''}`);
	if (!activeNow) fail(`${slug} is not active`);
}
if (failures) process.exit(1);

// 6) probes against the production webhook URLs; the fake store's open order costs 150.07
const callsBefore = (await (await fetch(STORE + '/calls')).json()).length;
const send = (slug, args) => {
	try {
		const out = execFileSync('node', [path.join(here, 'send.mjs'), `${BASE}/webhook/${slug}`, '--secret', TEST_KEY, ...args], { encoding: 'utf8', timeout: 60_000 });
		return out.trim().split('\n').filter((l) => /HTTP \d{3}/.test(l)).join(' | ');
	} catch (e) {
		return 'sender failed: ' + String(e.stdout ?? e.message).trim().split('\n').slice(-2).join(' | ');
	}
};
const codes = (line) => [...line.matchAll(/HTTP (\d{3})/g)].map((m) => Number(m[1]));
const expect = (slug, what, line, predicate, want) => {
	console.log(`  ${what.padEnd(18)} -> ${line}`);
	if (!predicate(codes(line), line)) fail(`${slug} ${what}: wanted ${want}`);
};
for (const [slug] of selected) {
	console.log(`\n== ${slug}`);
	expect(slug, 'webhook.test', send(slug, ['--event', 'webhook.test']), (c) => c.length >= 1 && c.every((x) => x === 200), 'HTTP 200');
	expect(slug, 'received 150.07', send(slug, ['--amount', '150.07']), (c, l) => c.length >= 1 && c.every((x) => x === 200) && /matched/.test(l), 'HTTP 200 with a matched reply');
	expect(slug, 'probe (2 x 401)', send(slug, ['--probe']), (c) => c.length >= 2 && c.every((x) => x === 401), 'two HTTP 401');
	expect(slug, 'forgery', send(slug, ['--forgery', '--amount', '150.07']), (c) => c.length >= 2 && c.every((x) => x === 200), 'HTTP 200 for both deliveries');
}
const calls = (await (await fetch(STORE + '/calls')).json()).slice(callsBefore);
console.log(`\nfake store calls during this run (${calls.length}):`);
for (const c of calls) console.log('  ', c.method, c.path, short(c.body, 120));
for (const [slug] of selected) {
	// each template: the matched transfer marks its order paid, the forgery verdict stops it
	if (!calls.some((c) => c.method === 'POST' && c.path === '/qersh/mark-paid')) fail(`${slug}: no mark-paid call reached the store`);
	if (!calls.some((c) => c.method === 'POST' && c.path === '/qersh/stop-order')) fail(`${slug}: no stop-order call reached the store`);
}
const markPaid = calls.filter((c) => c.path === '/qersh/mark-paid').length;
const stopped = calls.filter((c) => c.path === '/qersh/stop-order').length;
console.log(`mark-paid calls: ${markPaid}, stop-order calls: ${stopped} (expected at least ${selected.length} each)`);
if (markPaid < selected.length || stopped < selected.length) fail('fewer store calls than templates');

console.log(failures ? `\n${failures} failure(s)` : '\nclean install check passed');
process.exit(failures ? 1 : 0);
