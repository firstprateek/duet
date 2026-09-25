/**
 * The relay protocol: what the app and the relay on the Mac mini say to each other. Kept in
 * its own module with no other imports, so the relay can use it without pulling in the app.
 *
 * Every request carries the protocol version in `Duet-Protocol`; the relay accepts the
 * current and the previous one. Requests from a device carry `Authorization: Bearer <token>`.
 * Someone holding a recovery phrase can read the log (for `duet export`) with `Duet-Key-Id`
 * and `Duet-Key-Proof` instead.
 */

export const PROTOCOL = 1;
export const MIN_PROTOCOL = 1;
export const PROTOCOL_HEADER = "Duet-Protocol";
export const KEY_ID_HEADER = "Duet-Key-Id";
export const KEY_PROOF_HEADER = "Duet-Key-Proof";

/** The household log. A personal stream (a later version) would sit beside it. */
export const HOUSEHOLD_STREAM = "household";

/** An invite (join code) works once, for ten minutes. */
export const INVITE_MINUTES = 10;

/** Most envelopes in one push, and the largest one. */
export const MAX_PUSH = 500;
export const MAX_CIPHERTEXT = 64 * 1024;

/** An encrypted change record, as the relay stores it: it can never read `ciphertext`. */
export interface Envelope {
  /** The record's own id (UUIDv7), so pushing twice is harmless. */
  id: string;
  stream: string;
  /** The relay's id for the device that pushed it; bound into the ciphertext. */
  deviceId: string;
  /** base64url, 24 bytes */
  nonce: string;
  /** base64url */
  ciphertext: string;
  /** Assigned by the relay, in the order it received them. */
  seq?: number;
}

/** A household key wrapped by one person's recovery phrase. */
export interface WrappedKey {
  keyId: string;
  nonce: string;
  ciphertext: string;
}

/** Sent with a wrapped key: the relay keeps only its hash, and checks it on restore. */
export interface NewWrappedKey extends WrappedKey {
  proof: string;
}

export interface Health {
  ok: true;
  protocol: number;
  minProtocol: number;
  version: string;
  /** Whether a household has been set up on this relay yet. */
  ready: boolean;
}

export interface CreateHouseholdRequest {
  deviceName: string;
  memberId: string;
  key: NewWrappedKey;
}

export interface DeviceGrant {
  householdId: string;
  deviceId: string;
  deviceToken: string;
  memberId: string | null;
}

export interface InviteRequest {
  /** The member the invite is for (the second of us, already in the household log). */
  memberId: string;
}

export interface InviteResponse {
  invite: string;
  expiresAt: string;
}

export interface JoinRequest {
  invite: string;
  deviceName: string;
  key: NewWrappedKey;
}

export interface RestoreRequest {
  keyId: string;
  proof: string;
  deviceName: string;
}

export interface RestoreResponse extends DeviceGrant {
  key: WrappedKey;
}

export interface PushRequest {
  envelopes: Envelope[];
}

export interface PushResponse {
  /** How many were new (the rest were already there). */
  stored: number;
  latest: number;
}

export interface PullResponse {
  envelopes: Array<Envelope & { seq: number }>;
  latest: number;
  more: boolean;
}

export interface DeviceInfo {
  id: string;
  name: string;
  memberId: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  current: boolean;
}

export interface ErrorResponse {
  error: string;
}
