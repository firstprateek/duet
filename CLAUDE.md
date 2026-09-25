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
- `pnpm dev` — the real desktop app (needs Rust)

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

## Sample data and the designs

`apps/desktop/src/demo/seed.ts` builds Jack and Jill's year for the browser preview. Its numbers
are the designs' numbers (August $7,842, Jill +$262, typical $6,980, the History and Trends
screens), and `apps/desktop/test/seed.test.ts` checks them against the real queries. When you
change insight wording or math, run that test: a failure means the app no longer matches the
designs, or the seed needs to follow a deliberate change.
