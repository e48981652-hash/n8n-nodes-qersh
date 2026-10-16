# Notes for coding agents working in this repository

- This is an n8n community node package submitted for n8n verification. Keep every rule of `npm run lint` (`n8n-node lint`, strict mode): no runtime dependencies, imports only from `n8n-workflow`, `node:crypto` and relative paths, no `process`, timers, `console` or file access, no `throw` inside a `catch`, English-only texts, `usableAsTool` present on regular nodes and never `true` on the trigger.
- `nodes/Qersh/lib/` is a generated copy of `packages/qersh-webhook` from the Qersh repository (hashes in `core.lock.json`, checked by `npm run check:core`). Never edit it here; change the source and re-export.
- `fixtures/test-vectors.json` is a copy of `kit/test-vectors.json` from the Qersh repository (it contains Arabic text: copy the file, never retype it). Test keys live only there, never as string literals in `.ts` files.
- Legal wording: Qersh is a "wallet notification relay", never a payment gateway or payment service provider; `npm run check:wording` enforces it on everything a user reads.
- Releases: `npm run release` on a clean `main` creates a bare version tag (`0.1.0`, never `v0.1.0`); the tag triggers `.github/workflows/publish.yml`, which publishes with npm provenance. After publishing, `npm run scan:check` runs n8n's scanner on the published version.
