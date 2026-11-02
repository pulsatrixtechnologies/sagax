// 2026-10-29: a login lent for one turn, and a
// Shop Pay or Link one-time card through a fake wallet issuer (no real
// wallet, no network, nothing charged).
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { vaultHandle, walletCardHandle } from "../../shared/credential-vault.ts";
import { CredentialVault, fillResolverFor, LOCAL_VAULT_PRINCIPAL } from "./credential-vault.ts";
import type { VaultKeySource } from "../mcp-oauth.ts";
import type { IssueOutcome, WalletIssuer } from "../wallet-issuer.ts";

const KEY: VaultKeySource = { kind: "key", key: Buffer.alloc(32, 9) };
// Stripe's documented test number for one-time cards: not a real card.
const TEST_PAN = "4000009990001984";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function vault(now = () => 1_700_000_000_000) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-coffre-"));
  dirs.push(dir);
  return { store: new CredentialVault(dir, () => KEY, now), dir };
}

describe("a login lent for one turn", () => {
  it("lives in memory only and ends with the turn the card resumed", async () => {
    let clock = 1_700_000_000_000;
    const { store, dir } = vault(() => clock);
    const lent = store.lend(LOCAL_VAULT_PRINCIPAL, { name: "example.test", domains: ["example.test"], username: "ada", password: "lent-secret-value" }, { botId: "bot-a", threadId: "t1" });
    expect(lent.lent).toBe(true);
    expect(store.list(LOCAL_VAULT_PRINCIPAL)).toEqual([]);
    expect(() => readFileSync(join(dir, "credential-vault.enc"), "utf8")).toThrow();
    const fill = () => store.resolveForFill(LOCAL_VAULT_PRINCIPAL, { handle: vaultHandle(lent.id), field: "password", botId: "bot-a", threadId: "t1", pageUrl: "https://example.test/login" });
    expect(store.armed(LOCAL_VAULT_PRINCIPAL, "bot-a", "t1")).toBe(true);
    // the turn that asked ends before the resumed one starts: the login stays
    store.turnPhase("t1", "ended");
    expect(await fill()).toMatchObject({ ok: true, value: "lent-secret-value" });
    store.turnPhase("t1", "started");
    expect(await fill()).toMatchObject({ ok: true });
    expect((await store.resolveForFill(LOCAL_VAULT_PRINCIPAL, { handle: vaultHandle(lent.id), field: "password", botId: "bot-b", threadId: "t1", pageUrl: "https://example.test/login" })).ok).toBe(false);
    store.turnPhase("t1", "ended");
    const after = await fill();
    expect(after.ok).toBe(false);
    expect(after.ok ? "" : after.message).toContain("lent for one turn");
    expect(store.armed(LOCAL_VAULT_PRINCIPAL, "bot-a", "t1")).toBe(false);
    // a turn that never ends: gone after the short limit
    const again = store.lend(LOCAL_VAULT_PRINCIPAL, { name: "example.test", domains: ["example.test"], password: "x-value" }, { botId: "bot-a", threadId: "t2" });
    clock += 16 * 60_000;
    expect(store.granted(LOCAL_VAULT_PRINCIPAL, again.id, "bot-a", "t2")).toBe(false);
  });
});

describe("a Shop Pay or Link one-time card", () => {
  function fakeIssuer(outcomes: IssueOutcome[]): WalletIssuer & { calls: number } {
    const issuer = {
      calls: 0,
      status: async () => ({ installed: true, signedIn: true }),
      issue: async () => {
        issuer.calls += 1;
        return outcomes.shift() ?? { ok: false as const, code: "failed" as const, detail: "none left" };
      },
    };
    return issuer;
  }

  it("asks the wallet after the approval and types its card without the bot seeing it", async () => {
    const { store } = vault();
    const issuer = fakeIssuer([
      { ok: false, code: "waiting", detail: "approve in the app" },
      { ok: true, card: { pan: TEST_PAN, cvc: "321", expMonth: 4, expYear: 2031, holder: "Ada Lovelace" } },
    ]);
    store.setWalletIssuer(issuer);
    store.chooseWallet(LOCAL_VAULT_PRINCIPAL, "link", true);
    expect((await store.walletLinksLive(LOCAL_VAULT_PRINCIPAL)).link).toMatchObject({ chosen: true, ready: true, missing: "" });
    const page = "https://shop.example.test/pay";
    const access = fillResolverFor(store, { principalId: LOCAL_VAULT_PRINCIPAL, botId: "bot-a", threadId: "t1" });
    expect(access.requestPurchase({ pageUrl: page, amount: "12.50", currency: "CAD", wallet: "link", merchant: "Cafe" }).ok).toBe(true);
    const pending = store.pendingPurchases(LOCAL_VAULT_PRINCIPAL)[0]!;
    const handle = walletCardHandle(pending.id);
    // nothing is asked before the approval
    expect((await store.resolveForFill(LOCAL_VAULT_PRINCIPAL, { handle, field: "cardNumber", botId: "bot-a", threadId: "t1", pageUrl: page })).ok).toBe(false);
    expect(issuer.calls).toBe(0);
    const answered = store.answerPurchase(LOCAL_VAULT_PRINCIPAL, pending.id, "once");
    expect(answered.note).toContain(handle);
    expect(answered.note).not.toContain("provider_unconfigured");
    const fill = (field: "cardNumber" | "cardExpiry" | "cardCvc" | "cardholder", url = page) => store.resolveForFill(LOCAL_VAULT_PRINCIPAL, { handle, field, botId: "bot-a", threadId: "t1", pageUrl: url });
    const waiting = await fill("cardNumber");
    expect(waiting.ok).toBe(false);
    expect(waiting.ok ? "" : waiting.message).toMatch(/approve/);
    const number = await fill("cardNumber");
    expect(number).toMatchObject({ ok: true, value: TEST_PAN });
    expect(await fill("cardExpiry")).toMatchObject({ ok: true, value: "04/31" });
    expect(await fill("cardCvc")).toMatchObject({ ok: true, value: "321" });
    expect(await fill("cardholder")).toMatchObject({ ok: true, value: "Ada Lovelace" });
    expect(issuer.calls).toBe(2);
    // each field once, on that page only
    expect((await fill("cardNumber")).ok).toBe(false);
    expect((await fill("cardNumber", "https://other.example.test/pay")).ok).toBe(false);
    const stored = (store as unknown as { load(p: string): unknown }).load(LOCAL_VAULT_PRINCIPAL);
    expect(JSON.stringify(stored)).not.toContain(TEST_PAN);
    const recorded = access.recordPurchase({ pageUrl: page, orderRef: "A-9" });
    expect(recorded).toMatchObject({ ok: true });
    expect(recorded.message).not.toContain(TEST_PAN);
  });

  it("says plainly when the wallet's tool is missing, and charges nothing", async () => {
    const { store } = vault();
    store.setWalletIssuer(fakeIssuer([{ ok: false, code: "provider_unconfigured", detail: "missing" }]));
    store.chooseWallet(LOCAL_VAULT_PRINCIPAL, "shop_pay", true);
    const page = "https://shop.example.test/pay";
    fillResolverFor(store, { principalId: LOCAL_VAULT_PRINCIPAL, botId: "bot-a", threadId: "t1" }).requestPurchase({ pageUrl: page, amount: "8.00", currency: "USD", wallet: "shop_pay" });
    const pending = store.pendingPurchases(LOCAL_VAULT_PRINCIPAL)[0]!;
    store.answerPurchase(LOCAL_VAULT_PRINCIPAL, pending.id, "once");
    const refused = await store.resolveForFill(LOCAL_VAULT_PRINCIPAL, { handle: walletCardHandle(pending.id), field: "cardNumber", botId: "bot-a", threadId: "t1", pageUrl: page });
    expect(refused.ok).toBe(false);
    expect(refused.ok ? "" : refused.message).toMatch(/Nothing was charged/);
  });
});
