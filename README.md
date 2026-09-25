# Duet

A local-first money app for two. Each of us uploads our own bank and card statements, sorts
them into **Ours** or **Mine**, and adds them to a shared month. Duet shows where our money
went, what a typical month looks like, and **Ebb & flow**: who has carried a little more toward
Ours, measured against **Our rhythm** (the ratio we set from our incomes). No due dates, no
debts, just a **Clean slate** whenever we feel like evening out.

Everything runs on our own computers. A Mac mini on our tailnet relays end-to-end-encrypted
changes between the two Macs and runs the local models that help with sorting. The server only
ever stores ciphertext.

> Duet is a working name, and the project is being built now. See the milestones below.

## Status

| Milestone | What ships | State |
| --- | --- | --- |
| M0 Foundations | Monorepo, Tauri + Lit shell, tokens, SQLite, pipelines, installer, updater | In progress |
| M1 Uploads and sorting | CSV / XLSX / OFX, ten bank profiles, duplicates, transfers, refunds, To sort | In progress |
| M2 Month view and Ebb & flow | Month, Trends, Transactions, Our rhythm, Clean slate, insights | In progress |
| M3 Sync and encryption | Keys, recovery phrases, pairing, relay, merging, export CLI | Not started |
| M4 Smart sorting | Embeddings, local LLM, Laya, evaluation | Not started |
| M5 v1.0 | Accessibility, first run, README and self-hosting guide | Not started |

## Development

Needs Node 22.13+, pnpm, and (for the desktop app) Rust.

```bash
pnpm install
pnpm test
pnpm dev:web   # the app in a browser with sample data
pnpm dev       # the desktop app
```

## License

The app and server are AGPL-3.0. The statement importers in `packages/importers` are MIT, so
anyone can reuse the bank profiles.
