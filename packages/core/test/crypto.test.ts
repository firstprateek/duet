import { describe, expect, it } from "vitest";
import {
  decodeJoinCode,
  encodeJoinCode,
  isRecoveryPhrase,
  keysFromPhrase,
  newHouseholdKey,
  newRecoveryPhrase,
  openRecord,
  proofHash,
  sealRecord,
  unwrapHouseholdKey,
  wordsToCheck,
  wrapHouseholdKey,
} from "../src/crypto.ts";
import type { ChangeRecord } from "../src/store.ts";

const record: ChangeRecord = {
  id: "0192d0a4-0000-7000-8000-000000000001",
  hlc: "2026-09-23T18:04:11.201Z-0003-d-jack",
  entity: "transaction",
  entityId: "tx-1",
  fields: { categoryId: "groceries", amount: 8642 },
  schema: 1,
  memberId: "jack",
};

describe("recovery phrases", () => {
  it("are 24 words, and read the same however they're typed", () => {
    const phrase = newRecoveryPhrase();
    expect(phrase.split(" ")).toHaveLength(24);
    expect(isRecoveryPhrase(phrase)).toBe(true);
    expect(isRecoveryPhrase(`  ${phrase.toUpperCase().replace(/ /g, "   ")}\n`)).toBe(true);
    expect(keysFromPhrase(phrase.toUpperCase())).toEqual(keysFromPhrase(phrase));
  });

  it("refuse anything else", () => {
    const words = newRecoveryPhrase().split(" ");
    expect(isRecoveryPhrase(words.slice(0, 12).join(" "))).toBe(false);
    words[3] = words[3] === "abandon" ? "zoo" : "abandon";
    expect(isRecoveryPhrase(words.join(" "))).toBe(false);
    expect(() => keysFromPhrase("not a phrase")).toThrow("recovery phrase");
  });

  it("give each person their own key id and proof", () => {
    const a = keysFromPhrase(newRecoveryPhrase());
    const b = keysFromPhrase(newRecoveryPhrase());
    expect(a.keyId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.keyId).not.toBe(b.keyId);
    expect(a.proof).not.toBe(b.proof);
    expect(proofHash(a.proof)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("pick three different words to check", () => {
    for (let i = 0; i < 20; i++) {
      const picked = wordsToCheck();
      expect(new Set(picked).size).toBe(3);
      expect(picked.every((n) => n >= 1 && n <= 24)).toBe(true);
      expect([...picked].sort((a, b) => a - b)).toEqual(picked);
    }
  });
});

describe("the household key", () => {
  it("unwraps with either phrase that wrapped it", () => {
    const key = newHouseholdKey();
    const jack = newRecoveryPhrase();
    const jill = newRecoveryPhrase();
    expect(unwrapHouseholdKey(wrapHouseholdKey(key, jack), jack)).toEqual(key);
    expect(unwrapHouseholdKey(wrapHouseholdKey(key, jill), jill)).toEqual(key);
  });

  it("stays shut to another phrase", () => {
    const wrapped = wrapHouseholdKey(newHouseholdKey(), newRecoveryPhrase());
    expect(() => unwrapHouseholdKey(wrapped, newRecoveryPhrase())).toThrow(
      "doesn't open this household",
    );
  });
});

describe("records", () => {
  const key = newHouseholdKey();

  it("open to what was sealed", () => {
    const envelope = sealRecord(record, key, "device-jack");
    expect(envelope).toMatchObject({ id: record.id, stream: "household", deviceId: "device-jack" });
    expect(envelope.ciphertext).not.toContain("groceries");
    expect(openRecord(envelope, key)).toEqual(record);
  });

  it("can't be moved to another device or id, or altered", () => {
    const envelope = sealRecord(record, key, "device-jack");
    expect(() => openRecord({ ...envelope, deviceId: "device-jill" }, key)).toThrow();
    expect(() => openRecord({ ...envelope, id: "another-id" }, key)).toThrow();
    const flipped = envelope.ciphertext.startsWith("A")
      ? `B${envelope.ciphertext.slice(1)}`
      : `A${envelope.ciphertext.slice(1)}`;
    expect(() => openRecord({ ...envelope, ciphertext: flipped }, key)).toThrow();
    expect(() => openRecord(envelope, newHouseholdKey())).toThrow();
  });
});

describe("join codes", () => {
  it("carry the relay, the invite and the household key", () => {
    const code = {
      relayUrl: "https://mac-mini.tail1234.ts.net",
      invite: "invite-token",
      householdKey: newHouseholdKey(),
      householdId: "household-1",
      memberId: "jill",
    };
    const text = encodeJoinCode(code);
    expect(text.startsWith("DUET1-")).toBe(true);
    expect(decodeJoinCode(`  ${text}\n`)).toEqual(code);
  });

  it("can be read out of a join link", () => {
    const code = {
      relayUrl: "https://mac-mini.tail1234.ts.net",
      invite: "invite-token",
      householdKey: newHouseholdKey(),
      householdId: "household-1",
      memberId: "jill",
    };
    const text = encodeJoinCode(code);
    expect(decodeJoinCode(`https://example.github.io/duet/join/#${text}`)).toEqual(code);
    expect(decodeJoinCode(`duet://join#${text}`)).toEqual(code);
  });

  it("say so when they're cut short or aren't ours", () => {
    const text = encodeJoinCode({
      relayUrl: "https://mini.ts.net",
      invite: "i",
      householdKey: newHouseholdKey(),
      householdId: "h",
      memberId: "m",
    });
    expect(() => decodeJoinCode(text.slice(0, 30))).toThrow("incomplete");
    expect(() => decodeJoinCode("hello")).toThrow("isn't a Duet join code");
  });
});
