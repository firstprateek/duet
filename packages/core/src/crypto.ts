import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { generateMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { fromBase64Url, toBase64Url } from "./ids.ts";
import {
  type Envelope,
  HOUSEHOLD_STREAM,
  type NewWrappedKey,
  type WrappedKey,
} from "./protocol.ts";
import type { ChangeRecord } from "./store.ts";

/**
 * End-to-end encryption for the household log (spec, "Sync and encryption").
 *
 * One random 256-bit household key encrypts every shared record with XChaCha20-Poly1305. The
 * record id and the device id are bound in as associated data, so the relay can't pass a
 * record off under another id or device. Each of us has a 24-word recovery phrase; through
 * HKDF it gives a key that wraps the household key, and the relay keeps only those wrapped
 * copies. Either phrase alone opens everything in the household.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SALT = encoder.encode("duet/v1");
const WRAP_AAD = encoder.encode("duet/v1 household key");

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function newHouseholdKey(): Uint8Array {
  return randomBytes(32);
}

/** 24 words: 256 bits, the same strength as the household key it protects. */
export function newRecoveryPhrase(): string {
  return generateMnemonic(wordlist, 256);
}

export function normalizePhrase(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(" ");
}

export function isRecoveryPhrase(phrase: string): boolean {
  const words = normalizePhrase(phrase);
  return words.split(" ").length === 24 && validateMnemonic(words, wordlist);
}

/** Three word positions (1-based) to check when a phrase is first shown. */
export function wordsToCheck(random: () => number = Math.random): number[] {
  const picked = new Set<number>();
  while (picked.size < 3) picked.add(1 + Math.floor(random() * 24));
  return [...picked].sort((a, b) => a - b);
}

export interface PhraseKeys {
  /** Finds this person's wrapped household key on the relay. */
  keyId: string;
  /** Shows the relay we hold the phrase; it keeps only a hash of this. */
  proof: string;
  /** Wraps the household key. Never leaves this Mac. */
  wrappingKey: Uint8Array;
}

export function keysFromPhrase(phrase: string): PhraseKeys {
  if (!isRecoveryPhrase(phrase)) throw new Error("That isn't a Duet recovery phrase.");
  const entropy = mnemonicToEntropy(normalizePhrase(phrase), wordlist);
  const derive = (info: string, length: number) =>
    hkdf(sha256, entropy, SALT, encoder.encode(info), length);
  return {
    keyId: hex(derive("key id", 16)),
    proof: toBase64Url(derive("restore proof", 32)),
    wrappingKey: derive("wrap household key", 32),
  };
}

/** What the relay keeps in place of a proof. */
export function proofHash(proof: string): string {
  return hex(sha256(encoder.encode(proof)));
}

export function wrapHouseholdKey(householdKey: Uint8Array, phrase: string): NewWrappedKey {
  const keys = keysFromPhrase(phrase);
  const nonce = randomBytes(24);
  const ciphertext = xchacha20poly1305(keys.wrappingKey, nonce, WRAP_AAD).encrypt(householdKey);
  return {
    keyId: keys.keyId,
    proof: keys.proof,
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(ciphertext),
  };
}

export function unwrapHouseholdKey(wrapped: WrappedKey, phrase: string): Uint8Array {
  const keys = keysFromPhrase(phrase);
  try {
    return xchacha20poly1305(keys.wrappingKey, fromBase64Url(wrapped.nonce), WRAP_AAD).decrypt(
      fromBase64Url(wrapped.ciphertext),
    );
  } catch {
    throw new Error("That recovery phrase doesn't open this household.");
  }
}

function recordAad(id: string, deviceId: string): Uint8Array {
  return encoder.encode(`duet/v1 record|${id}|${deviceId}`);
}

export function sealRecord(
  record: ChangeRecord,
  householdKey: Uint8Array,
  deviceId: string,
  stream: string = HOUSEHOLD_STREAM,
): Envelope {
  const nonce = randomBytes(24);
  const plaintext = encoder.encode(JSON.stringify(record));
  const ciphertext = xchacha20poly1305(householdKey, nonce, recordAad(record.id, deviceId)).encrypt(
    plaintext,
  );
  return {
    id: record.id,
    stream,
    deviceId,
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(ciphertext),
  };
}

export class SealedRecordError extends Error {
  readonly envelopeId: string;
  constructor(envelopeId: string) {
    super("A change on the relay couldn't be opened with our household key.");
    this.envelopeId = envelopeId;
  }
}

export function openRecord(envelope: Envelope, householdKey: Uint8Array): ChangeRecord {
  let plaintext: Uint8Array;
  try {
    plaintext = xchacha20poly1305(
      householdKey,
      fromBase64Url(envelope.nonce),
      recordAad(envelope.id, envelope.deviceId),
    ).decrypt(fromBase64Url(envelope.ciphertext));
  } catch {
    throw new SealedRecordError(envelope.id);
  }
  const record = JSON.parse(decoder.decode(plaintext)) as ChangeRecord;
  if (record.id !== envelope.id) throw new SealedRecordError(envelope.id);
  return record;
}

/**
 * The join code Jack's Mac shows for Jill's: the relay address, a one-time invite, and the
 * household key. It works once, for ten minutes, and should only travel between our own devices.
 */
export interface JoinCode {
  relayUrl: string;
  invite: string;
  householdKey: Uint8Array;
  householdId: string;
  /** The member joining (already in the household log, set up by the first of us). */
  memberId: string;
}

const JOIN_PREFIX = "DUET1-";

export function encodeJoinCode(code: JoinCode): string {
  const body = JSON.stringify({
    u: code.relayUrl,
    i: code.invite,
    k: toBase64Url(code.householdKey),
    h: code.householdId,
    m: code.memberId,
  });
  return JOIN_PREFIX + toBase64Url(encoder.encode(body));
}

export function decodeJoinCode(text: string): JoinCode {
  const trimmed = text.trim().replace(/\s+/g, "");
  if (!trimmed.startsWith(JOIN_PREFIX)) throw new Error("That isn't a Duet join code.");
  try {
    const body = JSON.parse(decoder.decode(fromBase64Url(trimmed.slice(JOIN_PREFIX.length)))) as {
      u: string;
      i: string;
      k: string;
      h: string;
      m: string;
    };
    const householdKey = fromBase64Url(body.k);
    if (householdKey.length !== 32 || !body.u || !body.i || !body.m) throw new Error();
    return {
      relayUrl: body.u,
      invite: body.i,
      householdKey,
      householdId: body.h,
      memberId: body.m,
    };
  } catch {
    throw new Error("That join code looks incomplete. Copy it again from the other Mac.");
  }
}
