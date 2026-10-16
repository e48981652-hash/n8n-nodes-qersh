## n8n

<!-- Generated from the README of @qersh/n8n-nodes-qersh by scripts/build-llms-section.mjs. Do not edit here. -->

Qersh (Qersh Pay) is an Android app that reads the incoming-transfer notifications of e-wallets (Vodafone Cash, Orange Cash, e& money, InstaPay) on the merchant's phone and sends a signed webhook to the merchant's server, so orders are confirmed automatically with no payment gateway. Qersh is a wallet notification relay, not a payment service provider.

Package: `@qersh/n8n-nodes-qersh` (npm, MIT). Repository: https://github.com/e48981652-hash/n8n-nodes-qersh. Docs page: https://qersh.cfd/en/integrations/n8n. Nodes: **Qersh Trigger** (`qershTrigger`) and **Qersh** (`qersh`); credential **Qersh Webhook API** (`qershWebhookApi`) with the single field `connectionSecret` ("Connection Key"). Everything below is the package README, section by section.

### What you get

- **Qersh Trigger**: starts a workflow for every delivery of one wallet. It verifies the `X-Qersh-Signature` header on the raw request body, answers `401` to anything that does not verify, filters the events you want, and emits one tidy item per delivery.
- **Qersh** node with three operations: **Verify Delivery** (the same check for people who prefer n8n's built-in Webhook node), **Build Setup Link** (the `qersh://setup` link the merchant opens on the phone), and **Match Transfer** (finds the order a transfer paid, by payer and by the time the money arrived, and returns the reply for the phone).
- **Qersh Webhook API** credential: one field, the wallet's connection key, stored encrypted by n8n. "API" is n8n's naming rule for credentials; Qersh has no API and never calls a server of ours.

### Install

- **n8n Cloud**: open the nodes panel, search for "Qersh", open the "More from the community" section and select **Install** (instance owners and admins only; the owner can hide community nodes in the Cloud Admin Panel).
- **Self-hosted**: Settings, Community Nodes, Install, enter `@qersh/n8n-nodes-qersh` (owner or admin role).

### Connect a wallet in five steps

1. Add a **Qersh Trigger** node, give it a path (for example `qersh`) and activate the workflow. Copy the **Production URL** the node shows.
2. On the phone, open the Qersh app: **More**, **Wallets**, **Add wallet**. Paste the URL as **your store URL** (or open a setup link, see below). Save: the phone generates the **connection key** and shows it once.
3. In n8n, create a **Qersh Webhook API** credential and paste the key into **Connection Key**. Select it in the trigger.
4. On the wallet page in the app, tap **Test connection**. The app sends a `webhook.test` delivery and two negative probes; it should report that the signature is verified. The delivery appears as an execution.
5. Transfer one pound to the wallet from another phone. The app shows **Reached your store** next to the transfer, with the reply of your workflow (for example `matched · ORD-1042`).

Your developer's link: the Qersh node's **Build Setup Link** operation (or the generator on the website) produces a `qersh://setup` link that fills in the URL, the wallet name and the wallet type on the phone. By default it carries no key, so the phone generates one, as above. Keep it that way unless you have a reason not to: a link with the key written into an n8n execution is a key stored outside the phone and the credential.

### Qersh Trigger

| Parameter | Meaning |
|---|---|
| Path | The last part of the webhook URL. One wallet per path; a second wallet is a second trigger with another path. |
| Events | Which events start the workflow. Default: `transfer.received`, `transfer.updated`, `webhook.test`. Every other event is answered with `200 {"status":"ignored"}` and does not run anything. |
| Respond | **When Last Node Finishes** (default): the phone receives the JSON of the first item of your last node, so a Set node at the end of each branch can answer `{"status":"matched","reference":"ORD-1042"}`. A failed execution becomes a `500`, the phone retries the same delivery and tells the merchant the store is not responding. Finish within 10 seconds. **Immediately**: `200 {"status":"ok"}` before the workflow runs; use it for long workflows, and know that a failed execution then only shows in n8n. |

The item your workflow receives:

```json
{
  "event": "transfer.received",
  "delivery_id": "3f2a9c6e-…", "attempt": 1, "redelivery": null, "test": false,
  "created_at": "2026-10-11T16:36:42+03:00",
  "wallet": { "id": "wlt_…", "provider": "vodafone_cash", "label": "Shop wallet", "number_masked": "0100****776" },
  "transfer": {
    "transfer_id": "trf_…", "direction": "in", "status": "completed",
    "amount": "150.07", "amount_minor": 15007, "currency": "EGP",
    "received_at": "2026-10-11T16:36:41+03:00",
    "payer": { "number": "01112233445", "handle": null, "name": "Assaad K Mansouri", "key": "01112233445" },
    "provider_txn_id": "099409626954", "balance_after": "3122.42",
    "risk": "low", "risk_reasons": [], "auto_confirm_ok": true,
    "balance_chain": "consistent", "suspected_forgery": false
  },
  "data": { "… the event's data exactly as it arrived …": "" },
  "envelope": { "… the whole delivery exactly as it arrived …": "" },
  "webhook_url": "https://your-n8n/webhook/qersh"
}
```

`transfer` is present for every `transfer.*` event and for `webhook.test` (then it is the sample under `data.sample`, with `test: true`, so never treat it as a payment). `payer.key` is the normalised payer identifier to match orders with: an Egyptian number as `01xxxxxxxxx`, or an InstaPay handle as `name@instapay`. `amount_minor` is an integer in piasters; compare integers, never parsed decimals. `suspected_forgery` is true when the phone's balance check refuted the message: stop the order this transfer paid until a human sees the money in the wallet app.

Status codes the trigger sends: `401` for a missing, malformed, stale (older than 300 seconds) or wrong signature, and when no credential is selected; `400` for a signed body that is not a `qersh.v1` envelope; `200 {"status":"ignored"}` for events you did not select. Everything else is your workflow's reply.

### Qersh node

| Operation | Input | Output |
|---|---|---|
| Verify Delivery | The item of a Webhook node with its **Raw Body** option on (binary field `data`), the `X-Qersh-Signature` header and the request headers; the credential. | The same tidy item as the trigger plus `verification: { valid: true }`, or `verification: { valid: false, reason }` when the signature does not match (reasons: `no_key`, `raw_body_unavailable`, `missing_header`, `malformed_header`, `stale_timestamp`, `bad_signature`). Branch with an IF node. The raw body is required: a re-serialised JSON body never matches the signature. |
| Build Setup Link | Webhook URL (HTTPS, or HTTP for a local address), wallet label (cut to 60 characters), wallet type, optional events (listing events switches off every event not listed), and whether to include the connection key (off by default). | `setup_url`, `webhook_url`, `includes_key`, `warnings`. |
| Match Transfer | The `transfer` object of a trigger item and a JSON array of candidate orders: `order_number`, `price_minor`, `paid_minor`, `payer_key`, `created_at`, `expires_at` (ISO-8601 with offset or epoch milliseconds). Options: late window (120 minutes), clock skew (10 minutes). | `status` (`matched`, `partial`, `overpaid`, `unmatched`, `review`), `reference`, `note`, `order_number`, `action` (`mark_paid`, `mark_partial` or null), `amount_minor`, `transfer_id`, `provider_txn_id`, `payer_key`. Given a `transfer.updated`, it returns `{ status: "ok", stop_order, reason }` instead. The output is ready to be the last node's JSON in "When Last Node Finishes" mode. |

Match Transfer applies the rules of the Qersh kit: the payer the customer registered at checkout identifies the order, the time the money arrived (`received_at`, never the time the delivery reached n8n) bounds the candidates, and the amount only decides between that payer's own open orders. A transfer never pays an order opened after the money arrived; a late delivery with no matching order is `review`; `auto_confirm_ok: false` is always `review`.

### Retries, duplicates and late deliveries

The phone retries a delivery that did not get a `2xx` (no answer, timeout, `5xx`, `3xx`, `408`, `425`, `429`) for at least 7 days, with the same `delivery_id`, and after an outage of your workflow it sends what waited, oldest first and at most two at a time. So a transfer can reach you minutes, days or weeks after the money did: always use `transfer.received_at`, never the arrival time, and keep `delivery_id` for at least 180 days so a repeated delivery produces no second row, message or payment. The trigger itself keeps no state; the templates do the de-duplication in the destination (a sheet lookup, a Data Table, your store).

A `4xx` other than `408`, `410`, `425`, `429` makes the phone retry slowly for 3 days and tells the merchant at once that the store refuses the messages. The trigger sends `401` only when the signature does not verify, which is what that alert is for.

### Security

- The connection key lives on the phone and in the n8n credential. It is never logged, never written into an item, and never sent anywhere by this package.
- Rotation: after **Generate a new key** in the app, the phone signs every delivery with the new key and with the previous one for 24 hours. Update the credential within that day; a delivery refused after that is retried for 3 days once the key matches again.
- Verification happens on the raw bytes of the request body, before any JSON parsing, with a constant-time comparison and a 300-second window on the signature timestamp.
- The workflow templates that do not use this package keep the key inside the workflow JSON (in a Set node). Do not export or share such a workflow with the key in it; the credential of this package is the safer place.
- The Qersh node can be used as a tool by an AI Agent (for example Match Transfer). If you do that, keep **Include Connection Key** off in Build Setup Link, otherwise the key would be sent to the language model with the tool result.

### Templates

Three templates ship in [`templates/`](templates/) and are submitted to the n8n library one at a time; each comes in a version with these nodes and a version with the built-in Webhook and Code nodes (that version needs `NODE_FUNCTION_ALLOW_BUILTIN=crypto` on self-hosted n8n; n8n Cloud provides `crypto` in the Code node already):

1. **Log wallet transfers to Google Sheets**: one row per transfer, no duplicate rows, a status update when a transfer is later flagged.
2. **Send a Telegram alert for every wallet transfer**: one message per transfer, de-duplicated in a Data Table, a warning when a transfer is flagged.
3. **Confirm store orders from wallet transfers**: look up the payer's open orders in your store, match, mark the order paid, and answer `matched` to the phone.

Import a file with **Workflows → Create → Import from File**, then follow the yellow note. [`templates/README.md`](templates/README.md) describes the store endpoints the third template expects and how the files are generated.

### Test locally

Run `npm run dev` to start n8n with these nodes, add the trigger, activate the workflow, and use the Qersh kit's sender against the **Production URL** (the Test URL accepts one request per "Listen for test event", so the probes below need an active workflow):

```bash
node kit/sink/send.mjs http://localhost:5678/webhook/qersh --secret qsk_YOUR_KEY --amount 199 --probe
node kit/sink/send.mjs http://localhost:5678/webhook/qersh --secret qsk_YOUR_KEY --late 72
node kit/sink/send.mjs http://localhost:5678/webhook/qersh --secret qsk_YOUR_KEY --held 15 --forgery
```

`--probe` adds a wrong signature and a stale timestamp, which must both be answered `401`. A real phone on the same network can post to a local `http://` address when the app's developer mode is on.

### Troubleshooting

- **The app says the store refuses the messages (`401`)**: the key in the credential differs from the wallet's key (check the wallet page in the app), or the phone's clock is off by more than five minutes.
- **`404` on the phone**: the workflow is not active, or the path changed. A test URL also answers `404` once its single request is used.
- **`500` in "When Last Node Finishes" mode**: the execution failed, or the last node emitted nothing on its first output (an IF node as the last node does that). End every branch with a Set node that emits the reply.
- **"There is a conflict with one of the webhooks" when activating**: two triggers share a path; give each wallet its own.
- **Redirects**: the phone treats `3xx` as an error; give it the final URL (watch `www` and trailing slashes).
- **n8n Cloud**: on Starter, five executions run at a time and the rest queue; if replies take longer than 10 seconds, switch the trigger to **Immediately**. Community nodes may be hidden by the instance owner in the Cloud Admin Panel.

### Links

- Guide for merchants and developers: https://qersh.cfd/en/integrations/n8n
- The integration kit (schema, byte-exact test vectors, reference verifiers and matcher): the `kit/` folder of the Qersh repository, also served at https://qersh.cfd/kit/
- Issues and contributions: https://github.com/e48981652-hash/n8n-nodes-qersh

### Warnings for agents

- Never put a connection key into a setup link, a workflow JSON, a URL or a chat message. The default Build setup link output has no key: the phone generates the key and the merchant pastes it into the n8n credential.
- The Webhook + Code templates keep the key inside the workflow; prefer the community node when it can be installed. Self-hosted n8n needs `NODE_FUNCTION_ALLOW_BUILTIN=crypto` for those templates.
- Answer the phone from the workflow only with `{"status": ..., "reference": ...}` as described above; any 5xx makes the phone retry the same delivery_id later, so keep handlers idempotent.
- Qersh has no hosted API: nothing can be fetched from Qersh. Everything arrives as a signed webhook, and the signature must be checked on the raw body bytes.
