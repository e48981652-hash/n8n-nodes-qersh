Title: Log wallet transfers to Google Sheets

Description (Markdown, ## headings only):

## Who this is for
Merchants in Egypt who receive payments on Vodafone Cash, Orange Cash, e& money or InstaPay and want every incoming transfer written to a Google Sheet automatically, without a payment gateway. Qersh (Qersh Pay) is an Android app that reads the wallet's incoming-transfer notifications on the merchant's phone and posts each one to your n8n workflow as a signed webhook. Qersh is a wallet notification relay, not a payment service provider: no money passes through Qersh or through n8n.

## How it works
1. The Webhook node receives the signed JSON delivery from the phone.
2. The Code node verifies the signature on the raw body with the wallet's connection key and answers 401 to anything else.
3. A valid delivery is answered with 200 at once; the connection test is left alone.
4. Each new transfer becomes one row: time, amount, payer, transaction id, wallet and risk verdict. Repeated deliveries are found by delivery_id and never logged twice.
5. A later "suspected forgery" verdict marks the row so nobody ships against that money.

## Setup
1. In Settings, paste the connection key the phone shows after you add the wallet.
2. Create a sheet with the header row listed in the yellow note and select it, with your Google credential, in the three Google Sheets nodes.
3. Activate the workflow and paste the Webhook node's production URL into the Qersh app (More, Wallets, Add wallet). "Test connection" on the phone must say the signature was verified.
4. Self-hosted n8n needs NODE_FUNCTION_ALLOW_BUILTIN=crypto for the Code node; n8n Cloud allows it.

This version uses only built-in nodes. The Qersh community node (@qersh-pay/n8n-nodes-qersh) does the same with an encrypted credential. Docs: https://qersh.cfd/en/integrations/n8n
