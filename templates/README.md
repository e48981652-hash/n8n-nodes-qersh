# Workflow templates

Three workflows that start from a Qersh delivery, each in two versions. Qersh (Qersh Pay) is a wallet notification relay for Egyptian e-wallets, not a payment service provider: the app on the merchant's phone reads the wallet's incoming-transfer notification and posts it to n8n as a signed `qersh.v1` webhook.

| Template | With the Qersh community node | Webhook + Code (no community node) |
|---|---|---|
| Log wallet transfers to Google Sheets | [`t1-log-wallet-transfers-to-google-sheets.json`](t1-log-wallet-transfers-to-google-sheets.json) | [`…webhook-code.json`](t1-log-wallet-transfers-to-google-sheets.webhook-code.json) |
| Send a Telegram alert for every wallet transfer | [`t2-send-a-telegram-alert-for-every-wallet-transfer.json`](t2-send-a-telegram-alert-for-every-wallet-transfer.json) | [`…webhook-code.json`](t2-send-a-telegram-alert-for-every-wallet-transfer.webhook-code.json) |
| Confirm store orders from wallet transfers | [`t3-confirm-store-orders-from-wallet-transfers.json`](t3-confirm-store-orders-from-wallet-transfers.json) | [`…webhook-code.json`](t3-confirm-store-orders-from-wallet-transfers.webhook-code.json) |

The two versions do the same work. The community-node version keeps the connection key in an encrypted n8n credential and verifies the signature inside **Qersh Trigger**; the Webhook + Code version works on any n8n without installing anything, but keeps the key in a **Settings** node, so that workflow must never be exported or shared. On self-hosted n8n the Code node needs `NODE_FUNCTION_ALLOW_BUILTIN=crypto`; n8n Cloud allows the `crypto` module.

## Import

In n8n: **Workflows → Create → Import from File** (or paste the JSON into an empty canvas). Then follow the yellow note's **Setup** section: credentials, the sheet or table, the chat id or the store URL, and finally the trigger's **Production URL** pasted into the Qersh app (More → Wallets → Add wallet → "your store URL"). The app's **Test connection** must say that the signature was verified before you send a real pound.

Every template answers the connection test (`webhook.test`) with `{"status":"ok"}` without touching the sheet, Telegram or the store.

## What the templates share

- The trigger listens to `transfer.received`, `transfer.updated` and `webhook.test`, and answers from the last node (`lastNode`), so the phone shows the workflow's own reply.
- Retries, resends and backfills carry the same `delivery_id`: T1 looks it up in the sheet and T2 in a Data table before acting; T3 leaves that to the store, which is the source of truth for orders.
- A later `transfer.updated` whose verdict is `suspected_forgery` marks the row (T1), warns on Telegram (T2) or stops the order in the store (T3).
- Telegram texts are English; translate them in the two Telegram nodes and keep the digits Latin.
- No key, credential id or personal data is in any file. Checked by `node scripts/check-templates.mjs`.

## Store endpoints for T3

Your store (or a tiny service in front of it) offers three endpoints; add its authentication to the HTTP Request nodes with an n8n credential.

| Call | Request | Response |
|---|---|---|
| `GET {store_base_url}/qersh/open-orders?payer=01012345678` | the payer key: `01xxxxxxxxx` or `name@instapay` | `{"orders":[{"order_number":"ORD-1","price_minor":15000,"paid_minor":0,"payer_key":"01012345678","created_at":"2026-10-16T09:00:00+03:00","expires_at":"2026-10-16T11:00:00+03:00","status":"open"}]}` |
| `POST {store_base_url}/qersh/mark-paid` | `{"order_number","status","amount_minor","transfer_id","provider_txn_id","payer","received_at"}` | any 2xx |
| `POST {store_base_url}/qersh/stop-order` | `{"transfer_id","reason":"suspected_forgery","delivery_id"}` | any 2xx |

`status` in the reply to the phone is `matched`, `partial`, `overpaid`, `review` or `unmatched`, with `reference` set to the order number when an order was paid (see `kit/README.md` in the Qersh repository for the contract).

## Editing the templates

The JSON files are generated: edit [`scripts/build-templates.mjs`](../scripts/build-templates.mjs), run `node scripts/build-templates.mjs`, and commit the result. CI fails when a committed file differs from the generator's output. The node types are `@qersh/n8n-nodes-qersh.qershTrigger` and `@qersh/n8n-nodes-qersh.qersh`; if the package is ever published under another name, change `PACKAGE` in the generator.
