// "Scanner avec l'iPhone" sealed end to end (JC 2026-10-21): the card read
// on the iPhone is encrypted for the New card form that asked, and only that
// form can open it. The server relays an opaque envelope and never holds the
// number in clear, not even in memory.
//
// Same HPKE as the phone key entry (RFC 9180 base mode, P-256, HKDF-SHA256,
// AES-256-GCM; ios/Sources/CompanionCore/PhoneSecret.swift), with one
// difference: the recipient is a one-time key the form makes for this scan
// (its private half never leaves the form), not the desktop's pinned key,
// which the harness opens itself. What this buys: the relay (server, logs,
// live frames, pushes, crash reports) never holds the number. It is not a
// defence against a malicious server, which serves the form's code and sees
// a typed card anyway. The six digit code both screens show is a pairing
// check (the right form and the right phone), not an authentication: 20
// bits a server could grind. A commit-reveal could come later. HPKE base
// mode authenticates no sender: any native session of the same person may
// answer (the routes allow only those). Wire contract with
// ios/Sources/CompanionCore/PhoneCardSeal.swift: change both or neither.
import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core";

export const CARD_SEAL_INFO = "Sagax phone card scan v1";
const AAD_LABEL = "sagax-phone-card-scan-v1";

const suite = new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function toBase64Url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(value: string): Uint8Array | null {
  if (!BASE64URL.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
    const text = atob(padded);
    const bytes = new Uint8Array(text.length);
    for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
    return toBase64Url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

/** An uncompressed P-256 point, base64url without padding. */
export function isCardSealPublicKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const bytes = fromBase64Url(value);
  return bytes !== null && bytes.length === 65 && bytes[0] === 4;
}

export interface SealedCard {
  encapsulatedKey: string;
  ciphertext: string;
}

/** The envelope's shape (the server checks only this: it cannot open it). */
export function isSealedCard(value: unknown): value is SealedCard {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const enc = typeof row.encapsulatedKey === "string" ? fromBase64Url(row.encapsulatedKey) : null;
  const ciphertext = typeof row.ciphertext === "string" && row.ciphertext.length <= 1_024 ? fromBase64Url(row.ciphertext) : null;
  return enc !== null && enc.length === 65 && ciphertext !== null && ciphertext.length > 16;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));
}

/** The first 16 bytes of the key's SHA-256, base64url (PhoneSecret's key id). */
export async function cardSealKeyId(publicKey: string): Promise<string> {
  const bytes = fromBase64Url(publicKey);
  if (!bytes || !isCardSealPublicKey(publicKey)) throw new Error("not a card scan key");
  return toBase64Url((await sha256(bytes)).slice(0, 16));
}

/** Six digits both screens show: bytes 16 to 19 of the key's SHA-256. */
export async function cardScanMatchCode(publicKey: string): Promise<string> {
  const bytes = fromBase64Url(publicKey);
  if (!bytes || !isCardSealPublicKey(publicKey)) throw new Error("not a card scan key");
  const digest = await sha256(bytes);
  const value = ((digest[16]! << 24) >>> 0) + (digest[17]! << 16) + (digest[18]! << 8) + digest[19]!;
  return String(value % 1_000_000).padStart(6, "0");
}

/** What the envelope is bound to: this scan request and this key. */
export function cardSealAAD(requestId: string, keyId: string): Uint8Array {
  return new TextEncoder().encode([AAD_LABEL, requestId, keyId].join("\n"));
}

export interface CardScanKey {
  publicKey: string;
  privateKey: CryptoKey;
}

/** A one-time key for one scan. Kept by the form, never sent but its public half. */
export async function createCardScanKey(): Promise<CardScanKey> {
  const pair = await suite.kem.generateKeyPair();
  const publicKey = toBase64Url(new Uint8Array(await suite.kem.serializePublicKey(pair.publicKey)));
  return { publicKey, privateKey: pair.privateKey };
}

export type OpenedCard = { number: string; expMonth?: number; expYear?: number; holder?: string };

/** Luhn check of a 13 to 19 digit card number. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let value = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
  }
  return sum % 10 === 0;
}

/** Open the phone's envelope in the form. Keeps the number, the expiry and
 * the name; anything else in it (a security code) is dropped. */
export async function openSealedCard(key: CardScanKey, requestId: string, sealed: SealedCard): Promise<OpenedCard> {
  if (!isSealedCard(sealed)) throw new Error("The phone's answer could not be read.");
  const keyId = await cardSealKeyId(key.publicKey);
  const recipient = await suite.createRecipientContext({
    recipientKey: key.privateKey,
    enc: fromBase64Url(sealed.encapsulatedKey)!.buffer as ArrayBuffer,
    info: new TextEncoder().encode(CARD_SEAL_INFO).buffer as ArrayBuffer,
  });
  const plaintext = await recipient.open(fromBase64Url(sealed.ciphertext)!.buffer as ArrayBuffer, cardSealAAD(requestId, keyId).buffer as ArrayBuffer);
  const row = JSON.parse(new TextDecoder().decode(plaintext)) as Record<string, unknown>;
  const number = String(row.number ?? "").replace(/[\s-]/g, "");
  if (!luhnValid(number)) throw new Error("The phone did not read a valid card number.");
  const month = Number(row.expMonth);
  const year = Number(row.expYear);
  const holder = typeof row.holder === "string" ? row.holder.trim().slice(0, 80) : "";
  return {
    number,
    ...(Number.isInteger(month) && month >= 1 && month <= 12 ? { expMonth: month } : {}),
    ...(Number.isInteger(year) && year >= 2000 && year <= 2100 ? { expYear: year } : {}),
    ...(holder ? { holder } : {}),
  };
}

/** Tests only: what the phone does (PhoneCardSeal.seal), in TypeScript. */
export async function sealCardForTest(publicKey: string, requestId: string, card: Record<string, unknown>): Promise<SealedCard> {
  const keyId = await cardSealKeyId(publicKey);
  const sender = await suite.createSenderContext({
    recipientPublicKey: await suite.kem.deserializePublicKey(fromBase64Url(publicKey)!.buffer as ArrayBuffer),
    info: new TextEncoder().encode(CARD_SEAL_INFO).buffer as ArrayBuffer,
  });
  const ciphertext = await sender.seal(new TextEncoder().encode(JSON.stringify(card)).buffer as ArrayBuffer, cardSealAAD(requestId, keyId).buffer as ArrayBuffer);
  return { encapsulatedKey: toBase64Url(new Uint8Array(sender.enc)), ciphertext: toBase64Url(new Uint8Array(ciphertext)) };
}
