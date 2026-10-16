# Changelog

## Unreleased

- Qersh Trigger: receives `qersh.v1` deliveries, verifies `X-Qersh-Signature` on the raw body (any live key during rotation, 300-second window), answers 401 on failure, filters events, emits one normalised item per delivery, and replies either from the last node of the workflow or immediately.
- Qersh node: Verify Delivery (for the built-in Webhook node with Raw Body), Build Setup Link (key-less by default), Match Transfer (payer-and-time matching from the Qersh kit).
- Qersh Webhook API credential: one connection key, format-checked.
