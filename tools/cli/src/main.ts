#!/usr/bin/env -S node --no-warnings
import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isRecoveryPhrase, normalizePhrase, SorterClient, Store } from "@duet/core";
import { NodeSqliteDriver } from "@duet/core/db/node";
import { describeReport, evaluate } from "./eval.ts";
import { exportHousehold, fileSource, inspectRelay, relaySource } from "./export.ts";

const HELP = `duet: our household's data, outside the app

  duet export [--from <relay.db | https://mac-mini…>] [--out ./duet-export] [--force]
      Asks for a recovery phrase (never stored) and writes household.json,
      transactions.csv, mine-totals.csv and duet.db, all decrypted.
      --from is the relay's database or any backup of it (default: the relay's own,
      ~/.duet-sync/relay.db), or the relay's address on the tailnet.

  duet inspect [--from <relay.db>]
      What's in a relay database: devices, how many changes, and when. Nothing is decrypted.

  duet phrase
      Checks a recovery phrase against the word list, to be sure a paper copy is right.

  duet eval [--db <duet.db>] [--sorter https://mac-mini…/sort] [--limit 500] [--model 100]
      Replays our sorted rows through each sorting step and reports how many would need no
      correction. --db defaults to this Mac's Duet database (a snapshot is used, never the
      live file); --sorter adds the Mac mini's embeddings and small LLM.
`;

function options(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[arg.slice(2)] = next;
      i++;
    } else out[arg.slice(2)] = true;
  }
  return out;
}

function defaultRelayDb(): string {
  return join(process.env.DUET_DATA ?? join(homedir(), ".duet-sync"), "relay.db");
}

/** Reads a line without echoing it, so the phrase stays out of the terminal's scrollback. */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          cleanup();
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          reject(new Error("Stopped."));
          return;
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function askPhrase(): Promise<string> {
  if (!process.stdin.isTTY) {
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    return text;
  }
  return readHidden("Recovery phrase (24 words, not shown): ");
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const opts = options(rest);
  if (command === "export") {
    const from = typeof opts.from === "string" ? opts.from : defaultRelayDb();
    const out = typeof opts.out === "string" ? opts.out : "duet-export";
    const phrase = await askPhrase();
    if (!isRecoveryPhrase(phrase)) {
      fail("Those words aren't a recovery phrase. Check each one against the paper copy.");
    }
    const source =
      /^https?:\/\//i.test(from) || /\.ts\.net\b/.test(from)
        ? relaySource(from, phrase)
        : fileSource(from);
    const summary = await exportHousehold(source, phrase, { out, force: opts.force === true });
    console.log(
      `Opened ${summary.records} changes (${summary.transactions} transactions) into ${summary.folder}: household.json, transactions.csv, mine-totals.csv and duet.db.`,
    );
    return;
  }
  if (command === "inspect") {
    const from = typeof opts.from === "string" ? opts.from : defaultRelayDb();
    const s = inspectRelay(from);
    console.log(`${from}`);
    console.log(`  Households: ${s.households}`);
    console.log(
      `  Changes: ${s.changes} (latest ${s.latest})${s.firstAt ? `, ${s.firstAt.slice(0, 10)} to ${s.lastAt?.slice(0, 10)}` : ""}`,
    );
    for (const d of s.devices) {
      console.log(
        `  Device: ${d.name}${d.removed ? " (removed)" : ""}${d.lastSeenAt ? `, last seen ${d.lastSeenAt.slice(0, 16).replace("T", " ")}` : ""}`,
      );
    }
    return;
  }
  if (command === "eval") {
    const db =
      typeof opts.db === "string"
        ? opts.db
        : join(homedir(), "Library", "Application Support", "app.duet.desktop", "duet.db");
    if (!existsSync(db)) fail(`There's no Duet database at ${db}. Pass --db.`);
    // A snapshot, so the app's own file is never touched (vectors get cached in the copy).
    const copy = join(mkdtempSync(join(tmpdir(), "duet-eval-")), "duet.db");
    new DatabaseSync(db, { readOnly: true }).exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
    const store = await Store.open(new NodeSqliteDriver(copy));
    const report = await evaluate(store, {
      sorter: typeof opts.sorter === "string" ? new SorterClient(opts.sorter) : undefined,
      limit: typeof opts.limit === "string" ? Number(opts.limit) : undefined,
      modelLimit: typeof opts.model === "string" ? Number(opts.model) : undefined,
    });
    console.log(describeReport(report));
    return;
  }
  if (command === "phrase") {
    const phrase = await askPhrase();
    const words = normalizePhrase(phrase).split(" ").filter(Boolean);
    if (isRecoveryPhrase(phrase)) console.log("That's a complete recovery phrase. Keep it safe.");
    else if (words.length !== 24)
      console.log(`That's ${words.length} words; a recovery phrase has 24.`);
    else
      console.log(
        "One of those words is off. Check them against the paper copy, especially the last.",
      );
    return;
  }
  console.log(HELP);
  if (command && command !== "help" && command !== "--help") process.exitCode = 1;
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
