import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readStatement } from "@duet/importers";
import { describe, expect, it } from "vitest";
import { NodeSqliteDriver } from "../src/db/node.ts";
import {
  addAccount,
  addByHand,
  addToMonth,
  beginImport,
  countToSort,
  decide,
  ebbFlowView,
  finishImport,
  getAccounts,
  getCategories,
  getDrafts,
  getFiles,
  getMembers,
  getTransaction,
  listTransactions,
  makeCleanSlateFromDraft,
  monthView,
  previewAdd,
  recordCleanSlate,
  removeFile,
  Store,
  setDraftCategory,
  setupHousehold,
  switchShare,
} from "../src/index.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(join(__dirname, "../../importers/fixtures", name)));

async function household() {
  const store = await Store.open(new NodeSqliteDriver(), { deviceId: "jack-mbp" });
  await setupHousehold(store, {
    names: ["Jack", "Jill"],
    me: 0,
    firstBp: 5800,
    fromMonth: "2026-01",
  });
  const [jack, jill] = await getMembers(store);
  return { store, jack: jack!, jill: jill! };
}

async function importFile(
  store: Store,
  name: string,
  ownerId: string,
  defaultShare: "ours" | "mine" = "ours",
) {
  const bytes = fixture(name);
  const parsed = readStatement(bytes, name);
  const outcome = await beginImport(store, { fileName: name, bytes, parsed });
  if (outcome.status === "ready") return outcome.fileId;
  expect(outcome.status).toBe("new-account");
  if (outcome.status !== "new-account") throw new Error("unexpected");
  const accountId = await addAccount(store, {
    ownerId,
    institution: outcome.suggestion.institution,
    name: outcome.suggestion.name,
    last4: outcome.suggestion.last4,
    kind: outcome.suggestion.kind,
    defaultShare,
    profileId: parsed.profileId,
  });
  const done = await finishImport(store, { fileName: name, bytes, parsed }, accountId);
  if (done.status !== "ready") throw new Error("not ready");
  return done.fileId;
}

describe("a month from files to added", () => {
  it("sets up the household with starter categories and cash accounts", async () => {
    const { store, jack } = await household();
    expect(store.memberId).toBe(jack.id);
    expect((await getCategories(store)).some((c) => c.id === "groceries")).toBe(true);
    const accounts = await getAccounts(store);
    expect(accounts.filter((a) => a.kind === "cash")).toHaveLength(2);
  });

  it("imports, flags, sorts and adds a statement", async () => {
    const { store, jack } = await household();
    const fileId = await importFile(store, "amex-activity.csv", jack.id);
    const drafts = await getDrafts(store, fileId);
    expect(drafts).toHaveLength(6);

    const payment = drafts.find((d) => d.kind === "payment")!;
    expect(payment.decision).toBe("aside");
    expect(payment.flags.asideReason).toBe("Card payment, set aside for you");

    const refund = drafts.find((d) => d.kind === "refund")!;
    expect(refund.flags.refund?.of).toBe(
      drafts.find((d) => d.description.startsWith("AMZN Mktp US*2K4"))!.id,
    );

    const joes = drafts.find((d) => d.merchant === "Trader Joe's")!;
    expect(joes).toMatchObject({ categoryId: "groceries", tier: "pack", decision: "pending" });

    // Sort: everything Ours except Blue Bottle.
    const blue = drafts.find((d) => d.merchant === "Blue Bottle Coffee")!;
    const rest = drafts
      .filter((d) => d.decision === "pending" && d.id !== blue.id)
      .map((d) => d.id);
    await decide(store, rest, "ours");
    await decide(store, [blue.id], "mine");
    await setDraftCategory(store, [blue.id], "coffee", { always: true });
    expect(await countToSort(store)).toBe(0);

    const preview = await previewAdd(store, fileId);
    expect(preview.ours.count).toBe(4);
    expect(preview.mine).toEqual({ count: 1, total: 1150 });
    expect(preview.aside.count).toBe(1);
    expect(preview.months).toEqual(["2026-08"]);

    await addToMonth(store, fileId);
    const [file] = await getFiles(store);
    expect(file).toMatchObject({ status: "added", added: 5, pending: 0 });

    const all = await listTransactions(store, { month: "2026-08" });
    expect(
      all
        .filter((t) => t.share === "ours")
        .map((t) => t.amount)
        .sort((a, b) => a - b),
    ).toEqual([-2499, 2499, 8642, 61240]);
    const mineTotal = await store.db.all<{ total: number; category_id: string }>(
      "SELECT total, category_id FROM mine_totals",
    );
    expect(mineTotal).toEqual([{ total: 1150, category_id: "coffee" }]);

    // The "always" choice became a personal rule, because Blue Bottle is Mine.
    const rules = await store.db.all<{ pattern: string }>("SELECT pattern FROM personal_rules");
    expect(rules).toEqual([{ pattern: "BLUE BOTTLE COFFEE" }]);
  });

  it("pairs a card payment with the bank debit across files", async () => {
    const { store, jack } = await household();
    const amex = await importFile(store, "amex-activity.csv", jack.id);
    const wf = await importFile(store, "wells-fargo.csv", jack.id);
    const payment = (await getDrafts(store, amex)).find((d) => d.kind === "payment")!;
    const debit = (await getDrafts(store, wf)).find((d) => d.amount === 234018)!;
    expect(debit.decision).toBe("aside");
    expect(debit.flags.transfer?.matchedWith).toBe(payment.id);
    const updated = (await getDrafts(store, amex)).find((d) => d.id === payment.id)!;
    expect(updated.flags.transfer?.matchedWith).toBe(debit.id);
  });

  it("turns a Zelle to the partner into a Clean slate", async () => {
    const { store, jack, jill } = await household();
    const fileId = await importFile(store, "chase-checking.csv", jack.id);
    const zelle = (await getDrafts(store, fileId)).find((d) => d.description.startsWith("Zelle"))!;
    expect(zelle.flags.cleanSlateCandidate).toBe(true);
    await makeCleanSlateFromDraft(store, zelle.id, "2026-08");
    const view = await ebbFlowView(store, "2026-08");
    expect(view.slates).toHaveLength(1);
    expect(view.slates[0]).toMatchObject({
      fromMember: jack.id,
      toMember: jill.id,
      amount: 50000,
      appliesTo: "2026-08",
    });
  });

  it("skips a file that was already uploaded", async () => {
    const { store, jack } = await household();
    await importFile(store, "citi.csv", jack.id);
    const bytes = fixture("citi.csv");
    const again = await beginImport(store, {
      fileName: "citi.csv",
      bytes,
      parsed: readStatement(bytes, "citi.csv"),
    });
    expect(again.status).toBe("already");
  });

  it("removes a file and, if asked, what it added", async () => {
    const { store, jack } = await household();
    const fileId = await importFile(store, "discover.csv", jack.id);
    const pending = (await getDrafts(store, fileId)).filter((d) => d.decision === "pending");
    await decide(
      store,
      pending.map((d) => d.id),
      "ours",
    );
    await addToMonth(store, fileId);
    expect(await listTransactions(store)).toHaveLength(2);
    await removeFile(store, fileId, { removeAdded: true });
    expect(await listTransactions(store)).toHaveLength(0);
    expect(await getFiles(store)).toHaveLength(0);
  });
});

describe("the month view", () => {
  it("adds up Ours and each person's Mine, and reads Ebb & flow", async () => {
    const { store, jack, jill } = await household();
    const cash = (await getAccounts(store)).filter((a) => a.kind === "cash");
    const jackCash = cash.find((a) => a.ownerId === jack.id)!.id;
    const jillCash = cash.find((a) => a.ownerId === jill.id)!.id;
    await addByHand(store, {
      amount: 340200,
      merchant: "Rent share",
      date: "2026-08-01",
      categoryId: "rent",
      share: "ours",
      accountId: jackCash,
      paidBy: jack.id,
    });
    await addByHand(store, {
      amount: 291600,
      merchant: "Groceries etc",
      date: "2026-08-03",
      categoryId: "groceries",
      share: "ours",
      accountId: jillCash,
      paidBy: jill.id,
    });
    await addByHand(store, {
      amount: 81200,
      merchant: "Books",
      date: "2026-08-04",
      categoryId: "education",
      share: "mine",
      accountId: jackCash,
      paidBy: jack.id,
    });

    const view = await monthView(store, "2026-08");
    expect(view.ours).toBe(631800);
    expect(view.mineByMember[jack.id]).toBe(81200);
    expect(view.total).toBe(713000);
    expect(view.byTop[0]?.category.id).toBe("home");
    expect(view.ebb.monthSentence).toBe("In August, Jill carried $262 extra.");
    expect(view.ebb.overallCarrier).toBe(jill.id);

    await recordCleanSlate(store, {
      from: jack.id,
      to: jill.id,
      amount: 26244,
      date: "2026-08-31",
      appliesTo: "2026-08",
    });
    const after = await monthView(store, "2026-08");
    expect(after.ebb.monthSentence).toBe("You're in step in August.");
    expect(after.ebb.overallSentence).toBe("You're in step.");
  });

  it("making something Mine takes it out of Ours and into the totals", async () => {
    const { store, jack } = await household();
    const cash = (await getAccounts(store)).find(
      (a) => a.kind === "cash" && a.ownerId === jack.id,
    )!.id;
    const id = await addByHand(store, {
      amount: 4500,
      merchant: "Haircut",
      date: "2026-09-18",
      categoryId: "hair-beauty",
      share: "ours",
      accountId: cash,
      paidBy: jack.id,
    });
    const tx = (await getTransaction(store, id))!;
    await switchShare(store, tx, "mine");
    expect((await getTransaction(store, id))?.share).toBe("mine");
    const ours = await store.db.all<{ merchant: string; deleted_at: string | null }>(
      "SELECT merchant, deleted_at FROM transactions WHERE id = ?",
      [id],
    );
    expect(ours[0]?.merchant).toBe("");
    expect(ours[0]?.deleted_at).not.toBeNull();
    const totals = await store.db.all<{ total: number }>(
      "SELECT total FROM mine_totals WHERE month = '2026-09'",
    );
    expect(totals).toEqual([{ total: 4500 }]);
  });
});

describe("two Macs", () => {
  it("merge field by field, newest clock wins, and pulling twice is harmless", async () => {
    let now = 1_790_000_000_000;
    const clock = () => now;
    const jack = await Store.open(new NodeSqliteDriver(), { deviceId: "jack", now: clock });
    await setupHousehold(jack, {
      names: ["Jack", "Jill"],
      me: 0,
      firstBp: 5800,
      fromMonth: "2026-01",
    });
    const jill = await Store.open(new NodeSqliteDriver(), { deviceId: "jill", now: clock });
    const setup = await jack.outbox();
    expect(await jill.applyRemote(setup)).toBe(setup.length);
    expect(await jill.applyRemote(setup)).toBe(0);
    const members = await getMembers(jill);
    jill.memberId = members[1]!.id;

    const cashJack = (await getAccounts(jack)).find((a) => a.ownerId === members[0]!.id)!.id;
    const id = await addByHand(jack, {
      amount: 1000,
      merchant: "Farmers market",
      date: "2026-09-20",
      categoryId: "groceries",
      share: "ours",
      accountId: cashJack,
      paidBy: members[0]!.id,
    });
    await jill.applyRemote(await jack.outbox());

    // Both edit the same transaction; Jill's later edit wins the category, Jack's note stays.
    now += 1000;
    const onJack = (await getTransaction(jack, id))!;
    await jack.write([
      { entity: "transaction", id, fields: { categoryId: "dining-out", note: "for the picnic" } },
    ]);
    now += 1000;
    await jill.write([{ entity: "transaction", id, fields: { categoryId: "hobbies" } }]);
    await jack.applyRemote(await jill.outbox());
    await jill.applyRemote(await jack.outbox());
    for (const store of [jack, jill]) {
      const tx = (await getTransaction(store, id))!;
      expect(tx.categoryId).toBe("hobbies");
      expect(tx.note).toBe("for the picnic");
    }
    expect(onJack.categoryId).toBe("groceries");

    // History shows every edit.
    const history = await jill.history("transaction", id);
    expect(history.map((h) => h.fields.categoryId).filter(Boolean)).toEqual([
      "groceries",
      "dining-out",
      "hobbies",
    ]);
  });
});
