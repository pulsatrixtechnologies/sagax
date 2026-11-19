import { execFileSync } from "node:child_process";
import { createHash, createSign, generateKeyPairSync, X509Certificate } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { verifyAssertion, verifyAttestation } from "./verify.ts";

const APP_ID = "TEAM123456.ca.example.app";
const sha = (...parts: Buffer[]) => { const h = createHash("sha256"); for (const p of parts) h.update(p); return h.digest(); };

// minimal CBOR writer for the test objects
const head = (major: number, n: number) => n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
const bytes = (b: Buffer) => Buffer.concat([head(2, b.length), b]);
const text = (s: string) => Buffer.concat([head(3, s.length), Buffer.from(s)]);
const map = (entries: [string, Buffer][]) => Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, v]) => [text(k), v])]);
const array = (items: Buffer[]) => Buffer.concat([head(4, items.length), ...items]);

const dir = mkdtempSync(join(tmpdir(), "attest-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const openssl = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });

/** A fake Apple chain: root, intermediate, and a leaf over `leafKey` with the nonce extension. */
function chain(nonce: Buffer, leafKeyPem: string) {
  writeFileSync(join(dir, "leaf.key"), leafKeyPem);
  openssl("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "root.key");
  openssl("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", "int.key");
  openssl("req", "-x509", "-new", "-key", "root.key", "-subj", "/CN=Test Root", "-days", "30", "-out", "root.pem", "-addext", "basicConstraints=critical,CA:TRUE");
  openssl("req", "-new", "-key", "int.key", "-subj", "/CN=Test Intermediate", "-out", "int.csr");
  writeFileSync(join(dir, "int.ext"), "basicConstraints=critical,CA:TRUE\n");
  openssl("x509", "-req", "-in", "int.csr", "-CA", "root.pem", "-CAkey", "root.key", "-CAcreateserial", "-days", "30", "-out", "int.pem", "-extfile", "int.ext");
  openssl("req", "-new", "-key", "leaf.key", "-subj", "/CN=Leaf", "-out", "leaf.csr");
  const der = Buffer.concat([Buffer.from("3024a122"), Buffer.from("0420", "hex"), nonce]).toString("hex");
  writeFileSync(join(dir, "leaf.ext"), `1.2.840.113635.100.8.2=DER:${der}\n`);
  openssl("x509", "-req", "-in", "leaf.csr", "-CA", "int.pem", "-CAkey", "int.key", "-CAcreateserial", "-days", "30", "-out", "leaf.pem", "-extfile", "leaf.ext");
  const derOf = (name: string) => new X509Certificate(readFileSync(join(dir, name))).raw;
  return { leaf: derOf("leaf.pem"), intermediate: derOf("int.pem"), rootPem: readFileSync(join(dir, "root.pem"), "utf8") };
}

function makeAttestation(opts: { appId?: string; counter?: number; clientData: string; tamperKeyId?: boolean }) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
  const keyIdBytes = sha(point);
  const counter = Buffer.alloc(4); counter.writeUInt32BE(opts.counter ?? 0);
  const credLen = Buffer.alloc(2); credLen.writeUInt16BE(keyIdBytes.length);
  const authData = Buffer.concat([sha(Buffer.from(opts.appId ?? APP_ID)), Buffer.from([0x40]), counter, Buffer.concat([Buffer.from("appattestdevelop")]), credLen, keyIdBytes]);
  const nonce = sha(authData, sha(Buffer.from(opts.clientData)));
  const certs = chain(nonce, privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace("BEGIN PRIVATE KEY", "BEGIN PRIVATE KEY"));
  const object = map([["fmt", text("apple-appattest")], ["attStmt", map([["x5c", array([bytes(certs.leaf), bytes(certs.intermediate)])], ["receipt", bytes(Buffer.from("r"))]])], ["authData", bytes(authData)]]);
  return { attestation: object.toString("base64"), keyId: (opts.tamperKeyId ? sha(Buffer.from("other")) : keyIdBytes).toString("base64"), rootPem: certs.rootPem };
}

describe("verifyAttestation", () => {
  it("accepts a well formed attestation and returns the key", () => {
    const a = makeAttestation({ clientData: "challenge-one-abcdefgh" });
    const verified = verifyAttestation({ ...a, clientData: "challenge-one-abcdefgh", appId: APP_ID });
    expect(verified).toMatchObject({ keyId: a.keyId, environment: "development" });
    expect(verified.publicKeyPem).toContain("BEGIN PUBLIC KEY");
  });
  it("refuses a chain that is not Apple's", () => {
    const a = makeAttestation({ clientData: "c-abcdefghijklmnop" });
    const { rootPem: _unused, ...rest } = a;
    expect(() => verifyAttestation({ ...rest, clientData: "c-abcdefghijklmnop", appId: APP_ID })).toThrow(/Apple root/);
  });
  it("refuses another app, another challenge, a wrong key id and a counter that is not 0", () => {
    const a = makeAttestation({ clientData: "c1-abcdefghijklmnop" });
    expect(() => verifyAttestation({ ...a, clientData: "c1-abcdefghijklmnop", appId: "TEAM123456.other" })).toThrow(/app id/);
    expect(() => verifyAttestation({ ...a, clientData: "c2-abcdefghijklmnop", appId: APP_ID })).toThrow(/nonce/);
    const t = makeAttestation({ clientData: "c3-abcdefghijklmnop", tamperKeyId: true });
    expect(() => verifyAttestation({ ...t, clientData: "c3-abcdefghijklmnop", appId: APP_ID })).toThrow(/key id/);
    const n = makeAttestation({ clientData: "c4-abcdefghijklmnop", counter: 3 });
    expect(() => verifyAttestation({ ...n, clientData: "c4-abcdefghijklmnop", appId: APP_ID })).toThrow(/counter/);
  });
});

describe("verifyAssertion", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const assertion = (clientData: string, counterValue: number, appId = APP_ID) => {
    const counter = Buffer.alloc(4); counter.writeUInt32BE(counterValue);
    const authData = Buffer.concat([sha(Buffer.from(appId)), Buffer.from([0x40]), counter]);
    const signer = createSign("sha256");
    signer.update(sha(authData, sha(Buffer.from(clientData))));
    return map([["signature", bytes(signer.sign(privateKey))], ["authenticatorData", bytes(authData)]]).toString("base64");
  };
  it("returns the counter of a good assertion and refuses a replay", () => {
    expect(verifyAssertion({ assertion: assertion("ch", 1), clientData: "ch", publicKeyPem, lastCounter: 0, appId: APP_ID })).toBe(1);
    expect(() => verifyAssertion({ assertion: assertion("ch", 1), clientData: "ch", publicKeyPem, lastCounter: 1, appId: APP_ID })).toThrow(/counter/);
  });
  it("refuses another challenge and another app", () => {
    expect(() => verifyAssertion({ assertion: assertion("ch", 2), clientData: "other", publicKeyPem, lastCounter: 0, appId: APP_ID })).toThrow(/signature/);
    expect(() => verifyAssertion({ assertion: assertion("ch", 2, "X.y"), clientData: "ch", publicKeyPem, lastCounter: 0, appId: APP_ID })).toThrow(/app id/);
  });
});
