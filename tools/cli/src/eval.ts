import {
  askModel,
  buildHistory,
  embeddingText,
  getCategories,
  getRules,
  type HistoryIndex,
  nearestCategories,
  type Share,
  type SorterClient,
  type Store,
  SURE,
  suggest,
  vectorsFor,
} from "@duet/core";

/**
 * `duet eval`: replays our sorted transactions, oldest first, as if each one were new. Each
 * row is suggested from what came before it: our rules, our history, the starter pack and the
 * bank's category on this Mac, then the Mac mini's embeddings and small LLM for the rows those
 * leave unsure. It reports how many rows would need no correction at each step (the M4 bar is
 * 90%), and how many each model got right on the rows that reached it. A model earns its place
 * only if it beats the steps before it.
 */

export interface Score {
  answered: number;
  right: number;
}

export interface EvalReport {
  rows: number;
  /** Rows whose suggestion would have been right, after each step. */
  right: { local: number; embeddings: number; model: number };
  /** Rows still below "sure" (0.85) for us to look at, after each step. */
  unsure: { local: number; embeddings: number; model: number };
  byTier: Record<string, Score>;
  embeddings: Score | null;
  model: Score | null;
}

interface Row {
  description: string;
  merchant: string;
  categoryId: string;
  share: Share;
  amount: number;
}

function learn(index: HistoryIndex, row: Row): void {
  const fresh = buildHistory([
    { description: row.description, categoryId: row.categoryId, share: row.share },
  ]);
  for (const [key, h] of fresh) {
    const known = index.get(key);
    if (!known) {
      index.set(key, h);
      continue;
    }
    known.total += h.total;
    known.ours += h.ours;
    known.mine += h.mine;
    for (const [c, n] of h.categories) known.categories.set(c, (known.categories.get(c) ?? 0) + n);
  }
}

export async function evaluate(
  store: Store,
  options: { sorter?: SorterClient; limit?: number; modelLimit?: number } = {},
): Promise<EvalReport> {
  const rows = (
    await store.db.all<{
      description: string | null;
      merchant: string | null;
      category_id: string;
      share: string;
      amount: number;
    }>(
      `SELECT description, merchant, category_id, share, amount FROM (
         SELECT description, merchant, category_id, 'ours' AS share, amount, date, added_at FROM transactions
           WHERE deleted_at IS NULL AND category_id IS NOT NULL
         UNION ALL
         SELECT description, merchant, category_id, 'mine' AS share, amount, date, added_at FROM mine_transactions
           WHERE deleted_at IS NULL AND category_id IS NOT NULL
       ) ORDER BY date, added_at`,
    )
  ).map(
    (r): Row => ({
      description: r.description || r.merchant || "",
      merchant: r.merchant || "",
      categoryId: r.category_id,
      share: r.share === "mine" ? "mine" : "ours",
      amount: Number(r.amount),
    }),
  );
  const limit = options.limit ?? 500;
  const start = Math.max(0, rows.length - limit);
  const categories = await getCategories(store, true);
  const rules = await getRules(store);

  // This Mac's tiers, replayed in order.
  const history: HistoryIndex = new Map();
  for (const row of rows.slice(0, start)) learn(history, row);
  const byTier: Record<string, Score> = {};
  const local: Array<{ categoryId: string | null; confidence: number }> = [];
  for (const row of rows.slice(start)) {
    const s = suggest(
      { description: row.description, merchant: row.merchant, accountDefault: row.share },
      { rules, history, categories },
    );
    const score = byTier[s.tier] ?? { answered: 0, right: 0 };
    if (s.categoryId) {
      score.answered++;
      if (s.categoryId === row.categoryId) score.right++;
    }
    byTier[s.tier] = score;
    local.push({ categoryId: s.categoryId, confidence: s.confidence });
    learn(history, row);
  }
  const evaluated = rows.slice(start);
  const current = local.map((l) => ({ ...l }));
  const countRight = () =>
    current.filter((c, i) => c.categoryId === evaluated[i]!.categoryId).length;
  const countUnsure = () => current.filter((c) => c.confidence < SURE).length;
  const report: EvalReport = {
    rows: evaluated.length,
    right: { local: countRight(), embeddings: 0, model: 0 },
    unsure: { local: countUnsure(), embeddings: 0, model: 0 },
    byTier,
    embeddings: null,
    model: null,
  };
  report.right.embeddings = report.right.model = report.right.local;
  report.unsure.embeddings = report.unsure.model = report.unsure.local;
  if (!options.sorter) return report;

  const health = await options.sorter.health();
  const texts = rows.map((r) => embeddingText(r.description, r.merchant));
  const neighboursOf: Array<ReturnType<typeof nearestCategories> | null> = evaluated.map(
    () => null,
  );

  // The Mac mini's embeddings: the nearest earlier rows vote.
  if (health.embed.ready) {
    const vectors = await vectorsFor(store, options.sorter, health.embed.model, texts);
    const score: Score = { answered: 0, right: 0 };
    evaluated.forEach((row, i) => {
      const at = start + i;
      const query = vectors.get(texts[at]!);
      if (!query?.length) return;
      const pool = rows.slice(0, at).map((r, j) => ({
        text: texts[j]!,
        merchant: r.merchant,
        categoryId: r.categoryId,
        vector: vectors.get(texts[j]!) ?? [],
      }));
      const near = nearestCategories(query, pool);
      neighboursOf[i] = near;
      if (current[i]!.confidence >= SURE) return;
      const top = near.candidates[0];
      if (top && top.score >= SURE && (near.neighbours[0]?.similarity ?? 0) >= 0.8) {
        score.answered++;
        if (top.categoryId === row.categoryId) score.right++;
        current[i] = { categoryId: top.categoryId, confidence: top.score };
      }
    });
    report.embeddings = score;
    report.right.embeddings = report.right.model = countRight();
    report.unsure.embeddings = report.unsure.model = countUnsure();
  }

  // The small LLM, on the rows still unsure (a sample, since each one is a model call).
  if (health.llm.ready) {
    const score: Score = { answered: 0, right: 0 };
    let asked = 0;
    for (const [i, row] of evaluated.entries()) {
      if (current[i]!.confidence >= SURE || asked >= (options.modelLimit ?? 100)) continue;
      asked++;
      const answer = await askModel(
        options.sorter,
        {
          description: row.description,
          merchant: row.merchant,
          amount: row.amount,
          bank_category: null,
        },
        neighboursOf[i]?.neighbours ?? [],
        categories,
      ).catch(() => null);
      if (!answer) continue;
      score.answered++;
      if (answer.categoryId === row.categoryId) score.right++;
      current[i] = { categoryId: answer.categoryId, confidence: answer.confidence };
    }
    report.model = score;
    report.right.model = countRight();
    report.unsure.model = countUnsure();
  }
  return report;
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");

export function describeReport(r: EvalReport): string {
  const lines = [
    `${r.rows} of our sorted rows, replayed oldest first.`,
    "",
    "Right without a correction:",
    `  On this Mac (rules, history, starter pack, bank):  ${pct(r.right.local, r.rows)}  (${r.unsure.local} left unsure)`,
  ];
  if (r.embeddings) {
    lines.push(
      `  + the Mac mini's embeddings:                        ${pct(r.right.embeddings, r.rows)}  (${r.unsure.embeddings} left unsure)`,
    );
  }
  if (r.model) {
    lines.push(
      `  + the small LLM:                                    ${pct(r.right.model, r.rows)}  (${r.unsure.model} left unsure)`,
    );
  }
  lines.push("", "Each step on the rows it answered:");
  for (const [tier, s] of Object.entries(r.byTier).sort((a, b) => b[1].answered - a[1].answered)) {
    if (s.answered)
      lines.push(
        `  ${tier.padEnd(10)} ${String(s.answered).padStart(5)} rows  ${pct(s.right, s.answered)} right`,
      );
  }
  if (r.embeddings) {
    lines.push(
      `  embeddings ${String(r.embeddings.answered).padStart(5)} rows  ${pct(r.embeddings.right, r.embeddings.answered)} right`,
    );
  }
  if (r.model) {
    lines.push(
      `  small LLM  ${String(r.model.answered).padStart(5)} rows  ${pct(r.model.right, r.model.answered)} right`,
    );
  }
  const best = Math.max(r.right.local, r.right.embeddings, r.right.model);
  lines.push(
    "",
    best / Math.max(1, r.rows) >= 0.9 ? "That meets the 90% bar." : "Not at the 90% bar yet.",
  );
  return lines.join("\n");
}
