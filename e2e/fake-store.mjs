// A pretend store for the T3 templates: one open order per payer the kit sender uses, plus the two POST endpoints.
// Run: node fake-store.mjs [port]  (default 8787). Logs every call. The order's price follows ?price_minor=... of the
// first open-orders call, so the kit sender's --amount can be matched exactly.
import http from 'node:http';

const port = Number(process.argv[2] ?? 8787);
const calls = [];
const now = () => Date.now();
const order = (payer, priceMinor) => ({
	order_number: 'ORD-' + payer.slice(-4),
	price_minor: priceMinor,
	paid_minor: 0,
	payer_key: payer,
	created_at: new Date(now() - 5 * 60_000).toISOString(),
	expires_at: new Date(now() + 2 * 60 * 60_000).toISOString(),
	status: 'open',
});

http.createServer((req, res) => {
	const chunks = [];
	req.on('data', (c) => chunks.push(c));
	req.on('end', () => {
		const url = new URL(req.url, 'http://x');
		const body = Buffer.concat(chunks).toString('utf8');
		calls.push({ method: req.method, path: url.pathname + url.search, body });
		console.log(req.method, url.pathname + url.search, body.slice(0, 300));
		const json = (code, data) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(data));
		if (req.method === 'GET' && url.pathname === '/qersh/open-orders') {
			const payer = url.searchParams.get('payer') ?? '';
			const price = Number(process.env.STORE_PRICE_MINOR ?? 15000);
			return json(200, { orders: payer ? [order(payer, price)] : [] });
		}
		if (req.method === 'POST' && url.pathname === '/qersh/mark-paid') return json(200, { ok: true });
		if (req.method === 'POST' && url.pathname === '/qersh/stop-order') return json(200, { ok: true });
		if (req.method === 'GET' && url.pathname === '/calls') return json(200, calls);
		json(404, { error: 'not_found' });
	});
}).listen(port, () => console.log('fake store on :' + port));
