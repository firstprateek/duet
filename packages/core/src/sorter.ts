import { type Category, categoryPath } from "./categories.ts";
import { chunk, placeholders } from "./db/driver.ts";
import { getCategories } from "./household.ts";
import { sha256Hex } from "./ids.ts";
import { cleanMerchant, normalizeText } from "./merchants.ts";
import type { Store } from "./store.ts";
import { type Alternative, SURE } from "./suggest.ts";

/**
 * Smart sorting with the Mac mini (spec, "Smart sorting"). The cheap tiers already ran on this
 * Mac as the rows came in: our rules, our history, the starter pack and the bank's category.
 * This pass works on the rows still unsure. It finds the nearest past transactions by meaning
 * (embeddings from the Mac mini, matched here), lets Laya choose once it's trained, and asks
 * the small LLM about whatever is left, always among our own categories. The Mac mini keeps
 * nothing; the vectors are cached here. When it's out of reach, everything simply waits.
 */

export interface SorterHealth {
  ok: boolean;
  ollama: boolean;
  embed: { model: string; ready: boolean };
  llm: { model: string; ready: boolean };
  laya: { ready: boolean };
}

export class SorterError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class SorterClient {
  readonly url: string;
  private readonly fetcher: Fetch;

  constructor(url: string, options: { fetch?: Fetch } = {}) {
    let base = url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
    this.url = base;
    this.fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(this.url + path, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new SorterError(0, "Can't reach the Mac mini's sorting service.");
    }
    if (!response.ok) {
      let message = `The sorting service answered ${response.status}.`;
      try {
        const data = (await response.json()) as { detail?: unknown };
        if (typeof data.detail === "string") message = data.detail;
      } catch {
        // not JSON
      }
      throw new SorterError(response.status, message);
    }
    return (await response.json()) as T;
  }

  health(): Promise<SorterHealth> {
    return this.request("GET", "/v1/health");
  }
  embed(texts: string[]): Promise<{ model: string; vectors: number[][] }> {
    return this.request("POST", "/v1/embed", { texts });
  }
  choose(text: string, candidates: string[]): Promise<{ index: number; probability: number }> {
    return this.request("POST", "/v1/choose", { text, candidates });
  }
  async generate<T>(prompt: string, schema: object, system?: string): Promise<T> {
    const { output } = await this.request<{ output: T }>("POST", "/v1/generate", {
      prompt,
      schema,
      system,
    });
    return output;
  }
}

// ————— Vectors —————

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** The text we embed for a row: the cleaned merchant and the raw description. */
export function embeddingText(description: string, merchant?: string | null): string {
  const clean = merchant?.trim() || cleanMerchant(description);
  const raw = normalizeText(description);
  return (clean && !raw.includes(normalizeText(clean)) ? `${clean} · ${raw}` : raw).slice(0, 256);
}

/** Vectors for texts, from the cache here where we have them and the Mac mini where we don't. */
export async function vectorsFor(
  store: Store,
  client: SorterClient,
  model: string,
  texts: readonly string[],
): Promise<Map<string, number[]>> {
  const unique = [...new Set(texts)];
  const hashes = new Map<string, string>();
  for (const t of unique) hashes.set(t, await sha256Hex(t));
  const out = new Map<string, number[]>();
  for (const part of chunk(unique, 400)) {
    const rows = await store.db.all<{ text_hash: string; vector: string }>(
      `SELECT text_hash, vector FROM embeddings WHERE model = ? AND text_hash IN (${placeholders(part.length)})`,
      [model, ...part.map((t) => hashes.get(t)!)],
    );
    const byHash = new Map(rows.map((r) => [r.text_hash, r.vector]));
    for (const t of part) {
      const cached = byHash.get(hashes.get(t)!);
      if (cached) out.set(t, JSON.parse(cached) as number[]);
    }
  }
  const missing = unique.filter((t) => !out.has(t));
  for (const part of chunk(missing, 128)) {
    const { model: used, vectors } = await client.embed(part);
    await store.db.batch(
      part.map((t, i) => ({
        sql: "INSERT OR REPLACE INTO embeddings (text_hash, model, vector) VALUES (?, ?, ?)",
        params: [hashes.get(t)!, used, JSON.stringify(vectors[i] ?? [])],
      })),
    );
    for (const [i, t] of part.entries()) out.set(t, vectors[i] ?? []);
  }
  return out;
}

export interface Neighbour {
  text: string;
  merchant: string;
  categoryId: string;
  similarity: number;
}

export interface Candidate {
  categoryId: string;
  /** Share of the neighbours' similarity-weighted votes, 0 to 1. */
  score: number;
}

/** The nearest past rows, and the categories they vote for (at most five). */
export function nearestCategories(
  query: readonly number[],
  pool: ReadonlyArray<{
    text: string;
    merchant: string;
    categoryId: string;
    vector: readonly number[];
  }>,
  k = 10,
): { neighbours: Neighbour[]; candidates: Candidate[] } {
  const neighbours = pool
    .map((p) => ({
      text: p.text,
      merchant: p.merchant,
      categoryId: p.categoryId,
      similarity: cosine(query, p.vector),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k)
    .filter((n) => n.similarity > 0);
  const votes = new Map<string, number>();
  let total = 0;
  for (const n of neighbours) {
    const weight = n.similarity ** 4;
    votes.set(n.categoryId, (votes.get(n.categoryId) ?? 0) + weight);
    total += weight;
  }
  const candidates = [...votes.entries()]
    .map(([categoryId, v]) => ({ categoryId, score: total ? v / total : 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return { neighbours, candidates };
}

/** What the model is told about a row. */
export interface ModelInput {
  description: string;
  merchant: string;
  amount: number;
  bank_category: string | null;
}

/**
 * Asks the small LLM for a category, among our own, with our nearest past rows as hints.
 * What the model says about its own confidence is a guess, so its answer never shows as sure.
 */
export async function askModel(
  client: SorterClient,
  row: ModelInput,
  neighbours: readonly Neighbour[],
  categories: readonly Category[],
): Promise<{ categoryId: string; confidence: number; why: string } | null> {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const leaves = categories.filter((c) => c.parentId);
  const pathOf = (id: string) => categoryPath(id, categories);
  const hints = neighbours
    .slice(0, 5)
    .map((n) => `- ${n.merchant}: ${pathOf(n.categoryId)}`)
    .join("\n");
  const prompt = [
    `Transaction: ${row.description}`,
    `Merchant: ${row.merchant}`,
    `Amount: $${(Math.abs(row.amount) / 100).toFixed(2)}${row.amount < 0 ? " (a refund)" : ""}`,
    row.bank_category ? `The bank calls it: ${row.bank_category}` : "",
    hints ? `Our past transactions that look similar:\n${hints}` : "",
    "",
    "Pick the category that fits best. Categories (id: name):",
    ...leaves.map((c) => `${c.id}: ${pathOf(c.id)}`),
  ]
    .filter((line) => line !== "")
    .join("\n");
  const answer = await client.generate<{ categoryId: string; confidence: number; reason?: string }>(
    prompt,
    {
      type: "object",
      properties: {
        categoryId: { type: "string", enum: leaves.map((c) => c.id) },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        reason: { type: "string", maxLength: 100 },
      },
      required: ["categoryId", "confidence"],
    },
    "You sort a couple's card and bank transactions into their own categories. Answer only in the JSON asked for. The reason is one short, plain sentence.",
  );
  const category = byId.get(answer.categoryId);
  if (!category) return null;
  return {
    categoryId: answer.categoryId,
    confidence: Math.max(0.3, Math.min(0.84, Number(answer.confidence) || 0.5)),
    why: sentence(answer.reason || `The Mac mini's model thinks this is ${category.name}`),
  };
}

// ————— The pass —————

interface DraftRow {
  id: string;
  description: string;
  merchant: string;
  amount: number;
  bank_category: string | null;
  category_id: string | null;
  confidence: number;
  alternatives: string;
}

export interface SmartSortResult {
  /** Rows the Mac mini's models improved. */
  improved: number;
  /** Rows still unsure because a model wasn't there to ask. */
  waiting: number;
}

/** Past rows we trust as examples: what we added, Ours and our own Mine. */
async function examples(
  store: Store,
): Promise<Array<{ text: string; merchant: string; categoryId: string }>> {
  const rows = await store.db.all<{
    description: string | null;
    merchant: string | null;
    category_id: string;
  }>(
    `SELECT description, merchant, category_id FROM (
       SELECT description, merchant, category_id, date FROM transactions WHERE deleted_at IS NULL AND category_id IS NOT NULL
       UNION ALL
       SELECT description, merchant, category_id, date FROM mine_transactions WHERE deleted_at IS NULL AND category_id IS NOT NULL
     ) ORDER BY date DESC LIMIT 4000`,
  );
  const seen = new Set<string>();
  const out: Array<{ text: string; merchant: string; categoryId: string }> = [];
  for (const r of rows) {
    const text = embeddingText(r.description || r.merchant || "", r.merchant);
    const key = `${text}|${r.category_id}`;
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push({
      text,
      merchant: r.merchant || cleanMerchant(r.description || ""),
      categoryId: r.category_id,
    });
    if (out.length >= 2000) break;
  }
  return out;
}

function sentence(text: string, max = 110): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const cut = clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
  return /[.!?…]$/.test(cut) ? cut : `${cut}.`;
}

/**
 * Improves the unsure rows of one file (or every open row) with the Mac mini's models. Rows
 * we've touched ourselves, rule rows and refunds are left alone, and nothing is decided: only
 * the suggested category, its confidence and the why change.
 */
export async function smartSort(
  store: Store,
  client: SorterClient,
  options: { fileId?: string } = {},
): Promise<SmartSortResult> {
  const where = options.fileId ? "AND file_id = ?" : "";
  const drafts = await store.db.all<DraftRow>(
    `SELECT id, description, merchant, amount, bank_category, category_id, confidence, alternatives FROM drafts
     WHERE decision = 'pending' AND added_at IS NULL AND kind IN ('purchase', 'refund', 'fee')
       AND tier NOT IN ('rule', 'refund', 'you', 'model') AND confidence < ? ${where}`,
    options.fileId ? [SURE, options.fileId] : [SURE],
  );
  if (drafts.length === 0) return { improved: 0, waiting: 0 };

  let health: SorterHealth;
  try {
    health = await client.health();
  } catch {
    return { improved: 0, waiting: drafts.length };
  }
  const categories = await getCategories(store);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const pathOf = (id: string) => categoryPath(id, categories);

  const draftText = new Map(drafts.map((d) => [d.id, embeddingText(d.description, d.merchant)]));
  const pool: Array<{ text: string; merchant: string; categoryId: string; vector: number[] }> = [];
  let vectors = new Map<string, number[]>();
  if (health.embed.ready) {
    const known = await examples(store);
    try {
      vectors = await vectorsFor(store, client, health.embed.model, [
        ...known.map((k) => k.text),
        ...draftText.values(),
      ]);
      for (const k of known) {
        const v = vectors.get(k.text);
        if (v?.length && byId.has(k.categoryId)) pool.push({ ...k, vector: v });
      }
    } catch {
      vectors = new Map();
    }
  }

  let improved = 0;
  let waiting = 0;
  for (const d of drafts) {
    const text = draftText.get(d.id)!;
    const query = vectors.get(text);
    const near =
      query?.length && pool.length
        ? nearestCategories(query, pool)
        : { neighbours: [], candidates: [] };
    const top = near.candidates[0];
    let pick: { categoryId: string; confidence: number; why: string } | null = null;

    // 1. Our own past rows agree, and they're close.
    if (top && top.score >= SURE && (near.neighbours[0]?.similarity ?? 0) >= 0.8) {
      const examplesText = [
        ...new Set(
          near.neighbours.filter((n) => n.categoryId === top.categoryId).map((n) => n.merchant),
        ),
      ]
        .slice(0, 2)
        .join(" and ");
      pick = {
        categoryId: top.categoryId,
        confidence: Math.min(0.95, top.score),
        why: sentence(
          `Like past rows at ${examplesText}, which were ${byId.get(top.categoryId)?.name ?? "that"}`,
        ),
      };
    }

    // 2. Laya, once it's trained, chooses among those candidates.
    if (!pick && health.laya.ready && near.candidates.length >= 2) {
      try {
        const names = near.candidates.map((c) => pathOf(c.categoryId));
        const choice = await client.choose(text, names);
        const chosen = near.candidates[choice.index];
        if (chosen && choice.probability >= 0.6) {
          pick = {
            categoryId: chosen.categoryId,
            confidence: choice.probability,
            why: sentence(
              `Laya picked ${byId.get(chosen.categoryId)?.name ?? "this"} from our own history`,
            ),
          };
        }
      } catch {
        // Laya isn't answering; the LLM can still help
      }
    }

    // 3. The small LLM, for new merchants and whatever is still unsure.
    if (!pick && health.llm.ready) {
      try {
        pick = await askModel(client, d, near.neighbours, categories);
      } catch {
        // the model didn't answer; the row keeps what it had
      }
    }

    if (!pick) {
      if (!health.embed.ready || !health.llm.ready) waiting++;
      continue;
    }
    if (pick.categoryId === d.category_id && pick.confidence <= Number(d.confidence)) continue;
    const alternatives: Alternative[] = near.candidates
      .filter((c) => c.categoryId !== pick.categoryId)
      .slice(0, 3)
      .map((c) => ({ categoryId: c.categoryId, confidence: Math.round(c.score * 100) / 100 }));
    await store.db.run(
      `UPDATE drafts SET category_id = ?, confidence = ?, tier = 'model', why = ?, alternatives = ?
       WHERE id = ? AND decision = 'pending' AND tier NOT IN ('rule', 'refund', 'you')`,
      [pick.categoryId, pick.confidence, pick.why, JSON.stringify(alternatives), d.id],
    );
    improved++;
  }
  if (improved) store.notify(["drafts"]);
  return { improved, waiting };
}
