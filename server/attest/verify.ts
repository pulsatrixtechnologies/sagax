// App Attest verification (Apple, "Validating apps that connect to your
// server"): an attestation proves a key lives in a genuine Apple device's
// Secure Enclave for this app; each assertion proves that key signed a
// fresh challenge. Pure functions: the store and the routes are elsewhere.
import { createHash, createPublicKey, verify as cryptoVerify, X509Certificate, type KeyObject } from "node:crypto";

import { decodeCbor } from "./cbor.ts";

/** Apple App Attestation Root CA (public, valid until 2045). */
export const APPLE_APP_ATTEST_ROOT_PEM = `-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----
`;

const AAGUID_PRODUCTION = Buffer.concat([Buffer.from("appattest"), Buffer.alloc(7)]);
const AAGUID_DEVELOPMENT = Buffer.from("appattestdevelop");
/** 1.2.840.113635.100.8.2, the nonce extension of the leaf certificate. */
const NONCE_OID = Buffer.from("06092a864886f763640802", "hex");

export type AttestEnvironment = "production" | "development";

export interface VerifiedAttestation {
  keyId: string;
  /** SPKI PEM of the attested key, kept to verify its assertions. */
  publicKeyPem: string;
  environment: AttestEnvironment;
  receipt: string;
}

const sha256 = (...parts: Uint8Array[]) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
};

const bytesOf = (value: unknown, what: string): Buffer => {
  if (!(value instanceof Uint8Array)) throw new Error(`attest: ${what} is not bytes`);
  return Buffer.from(value);
};

/** First OCTET STRING value inside the nonce extension. The extension is
 * SEQUENCE { [1] { OCTET STRING nonce } }: the 32 bytes follow 04 20. */
function nonceOfCertificate(cert: X509Certificate): Buffer {
  const raw = cert.raw;
  const at = raw.indexOf(NONCE_OID);
  if (at < 0) throw new Error("attest: nonce extension missing");
  const window = raw.subarray(at + NONCE_OID.length, at + NONCE_OID.length + 64);
  const marker = window.indexOf(Buffer.from([0x04, 0x20]), 4);
  if (marker < 0 || marker + 2 + 32 > window.length) throw new Error("attest: nonce extension unreadable");
  return Buffer.from(window.subarray(marker + 2, marker + 34));
}

function rawPoint(key: KeyObject): Buffer {
  const jwk = key.export({ format: "jwk" });
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) throw new Error("attest: not a P-256 key");
  return Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
}

export interface AttestationInput {
  /** base64 of the CBOR attestation object */
  attestation: string;
  /** base64 key id returned by generateKey */
  keyId: string;
  /** the exact string the app hashed as clientData (the challenge) */
  clientData: string;
  /** teamId.bundleId */
  appId: string;
  rootPem?: string;
  now?: number;
}

export function verifyAttestation(input: AttestationInput): VerifiedAttestation {
  const decoded = decodeCbor(Buffer.from(input.attestation, "base64"));
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded) || decoded instanceof Uint8Array) throw new Error("attest: malformed object");
  if (decoded.fmt !== "apple-appattest") throw new Error("attest: unexpected format");
  const stmt = decoded.attStmt as { x5c?: unknown; receipt?: unknown } | undefined;
  if (!stmt || !Array.isArray(stmt.x5c) || stmt.x5c.length < 2) throw new Error("attest: certificate chain missing");
  const authData = bytesOf(decoded.authData, "authData");

  // 1. chain: leaf <- intermediate <- Apple root, all inside their validity
  const leaf = new X509Certificate(bytesOf(stmt.x5c[0], "leaf"));
  const intermediate = new X509Certificate(bytesOf(stmt.x5c[1], "intermediate"));
  const root = new X509Certificate(input.rootPem ?? APPLE_APP_ATTEST_ROOT_PEM);
  const at = new Date(input.now ?? Date.now());
  for (const cert of [leaf, intermediate, root]) {
    if (at < new Date(cert.validFrom) || at > new Date(cert.validTo)) throw new Error("attest: certificate outside its validity");
  }
  if (!leaf.verify(intermediate.publicKey) || !intermediate.verify(root.publicKey) || !root.verify(root.publicKey)) {
    throw new Error("attest: chain does not lead to the Apple root");
  }

  // 2. nonce = SHA256(authData || SHA256(clientData))
  const clientDataHash = sha256(Buffer.from(input.clientData, "utf8"));
  if (!nonceOfCertificate(leaf).equals(sha256(authData, clientDataHash))) throw new Error("attest: nonce mismatch");

  // 3. key id = SHA256(public key point)
  const keyIdBytes = Buffer.from(input.keyId, "base64");
  if (!sha256(rawPoint(leaf.publicKey)).equals(keyIdBytes)) throw new Error("attest: key id does not match the certificate");

  // 4. authData: rpIdHash, flags, counter 0, aaguid, credentialId
  if (authData.length < 55) throw new Error("attest: authData too short");
  if (!authData.subarray(0, 32).equals(sha256(Buffer.from(input.appId, "utf8")))) throw new Error("attest: app id mismatch");
  if (authData.readUInt32BE(33) !== 0) throw new Error("attest: counter is not 0");
  const aaguid = authData.subarray(37, 53);
  const environment: AttestEnvironment | undefined = aaguid.equals(AAGUID_PRODUCTION) ? "production" : aaguid.equals(AAGUID_DEVELOPMENT) ? "development" : undefined;
  if (!environment) throw new Error("attest: unknown aaguid");
  const credentialLength = authData.readUInt16BE(53);
  if (!authData.subarray(55, 55 + credentialLength).equals(keyIdBytes)) throw new Error("attest: credential id mismatch");

  return {
    keyId: input.keyId,
    publicKeyPem: leaf.publicKey.export({ type: "spki", format: "pem" }).toString(),
    environment,
    receipt: stmt.receipt instanceof Uint8Array ? Buffer.from(stmt.receipt).toString("base64") : "",
  };
}

export interface AssertionInput {
  /** base64 of the CBOR assertion object */
  assertion: string;
  clientData: string;
  publicKeyPem: string;
  /** the counter stored after the last accepted assertion */
  lastCounter: number;
  appId: string;
}

/** Returns the new counter; throws when the assertion does not hold. */
export function verifyAssertion(input: AssertionInput): number {
  const decoded = decodeCbor(Buffer.from(input.assertion, "base64"));
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded) || decoded instanceof Uint8Array) throw new Error("assert: malformed object");
  const signature = bytesOf(decoded.signature, "signature");
  const authData = bytesOf(decoded.authenticatorData, "authenticatorData");
  if (authData.length < 37) throw new Error("assert: authData too short");
  const nonce = sha256(authData, sha256(Buffer.from(input.clientData, "utf8")));
  if (!cryptoVerify("sha256", nonce, createPublicKey(input.publicKeyPem), signature)) throw new Error("assert: bad signature");
  if (!authData.subarray(0, 32).equals(sha256(Buffer.from(input.appId, "utf8")))) throw new Error("assert: app id mismatch");
  const counter = authData.readUInt32BE(33);
  if (counter <= input.lastCounter) throw new Error("assert: counter did not increase (replay)");
  return counter;
}
