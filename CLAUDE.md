# Duet — notes for agents

A local-first money app for two people (Jack and Jill in the mocks). The v1 spec is a Claude Doc:
https://claude.ai/code/artifact/073b8ed5-cfd8-4987-83e3-78ed159a7dba. Final screens (direction C,
"Soft & friendly") are on the design canvas: https://claude.ai/artifact/UnZ2oXSq1s6K4jHUdHq4da.
Read the spec before changing behavior; it is the source of truth for words, math and privacy.

## Layout

| Path | What |
| --- | --- |
| `packages/core` | All business logic, plain TypeScript, no Tauri imports (AGPL) |
| `packages/importers` | CSV / XLSX / OFX readers, bank profiles, fixtures (MIT — keep it free of core imports) |
| `packages/ui` | Lit components and design tokens |
| `apps/desktop` | Tauri 2 shell + Lit screens; `src-tauri` holds the only Rust |
| `services/sync` | Bun relay (stores ciphertext only) |
| `services/sorter` | Python sorting service (Ollama, Laya) |
| `tools/cli` | `duet export` and key tools |

## Commands

- `pnpm test` — Vitest for core, importers and the app's logic
- `pnpm lint` / `pnpm format` — Biome
- `pnpm typecheck` — `tsc` per package (TypeScript 7)
- `pnpm dev:web` — the app in a browser with sample data (sql.js), no Tauri needed
- `pnpm dev` — the real desktop app (needs Rust). Debug builds use `duet-dev.db` and the keychain
  service `app.duet.desktop.dev`, so they never touch the household we use

## Conventions that matter

- Money is integer cents, spending positive, refunds negative. Never floats.
- Dates are `yyyy-MM-dd` strings, months `yyyy-MM`. No time zones in business logic.
- Every user-facing word for Duet's own ideas comes from `packages/core/src/words.ts`.
  Tone rules (spec, "Words we use"): plural and personal, never debt language, clear over cute,
  don't spell out who sees what.
- Shared entities change only through `Store.write` (clock-stamped change records → outbox).
  Local-only tables (drafts, statement files, meta) are written directly.
- The partner's Mine merchants must never reach the other Mac: only `mine_totals` are shared.
- Imports use `.ts` extensions (`allowImportingTsExtensions`); packages export source, no build step.

## Deliberate departures from the spec

- **SQLite access**: raw SQL through a small `SqlDriver` interface instead of Drizzle. The
  desktop driver is a Rust command using rusqlite on one connection (tauri-plugin-sql pools
  connections, which breaks multi-statement transactions). So Rust is ~150 lines, not 30.
- **SheetJS** is vendored in `vendor/` (it isn't on npm, and pnpm needs a verifiable tarball).
- **Charts** are small hand-drawn SVG Lit components in `packages/ui/src/charts.ts`, not
  ECharts: four simple charts didn't justify a megabyte, and SVG follows the tokens and dark mode.
- **Files waiting for their one-time setup** keep the dates and row count read loosely from the
  unknown layout, and Uploads guesses their account from the file name (display only; the setup
  still asks, and can add the file to an account we already have).

- **Tauri plugins**: dialog, updater and process only. The spec lists sql and fs too; SQLite
  goes through our Rust command instead (see above), and statement files are read by path
  through `read_statement_file`, which only opens statement extensions under 50 MB.
- **Relay updates** (`duet-server update`) check the release's SHA-256; the spec also asks for a
  signature, which needs the release key set up first (a later step).
- **Installs and updates come from the Mac mini, not GitHub.** The repository stays private, so
  `duet-server update` (signed in with `gh`) copies each release to `/usr/local/var/duet/app`
  and `tailscale serve` publishes it at `/app`, with `latest.json` rewritten to point there.
  The app asks the relay's address plus `/app/latest.json` through the `update_check` Rust
  command, since the updater's endpoint is only known at runtime; the release key's signature
  is still checked before anything installs.
- **The personal vault** (Mine details backed up under the owner's own key) is still an open
  question in the spec, so it isn't built; the envelope's `stream` field leaves room for it.

## Sync and sorting, in short

- One household per relay. The first Mac creates it; the second joins with a one-time code that
  carries the relay address, an invite, the household key and the joiner's member id. Anyone
  holding a recovery phrase can restore a Mac, or read the log read-only (`duet export`), with
  the key id and proof derived from the phrase; the relay stores only the proof's hash.
- The relay is plain `Request`/`Response` code (`services/sync/src/relay.ts`): Bun serves it on
  the Mac mini, Node serves it in tests and in `pnpm relay:dev`.
- Core runs under Node's type stripping (for the CLI), so avoid TypeScript-only runtime syntax
  there: no parameter properties, enums or namespaces.
- Smart sorting lives in `core/sorter.ts`. The sorting service is found at the relay's address
  plus `/sort` unless Settings says otherwise. An LLM answer never shows as sure (its confidence
  is capped at 0.84); only our rules and close agreement among our own past rows do.

## Sample data and the designs

`apps/desktop/src/demo/seed.ts` builds Jack and Jill's year for the browser preview. Its numbers
are the designs' numbers (August $7,842, Jill +$262, typical $6,980, the History and Trends
screens), and `apps/desktop/test/seed.test.ts` checks them against the real queries. When you
change insight wording or math, run that test: a failure means the app no longer matches the
designs, or the seed needs to follow a deliberate change.
