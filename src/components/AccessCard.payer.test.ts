// #1137: the access card says who pays for a shared bot's replies, names
// the bot, offers to choose a model the person can pay for, and says by name
// when the owner's computer (whose model the owner pays with) is offline.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { AccessCard, accessCardLines } from "./AccessCard";

const OWNER = "pr_owner";
const BOB = "pr_bob";
const KEYS = "https://px.example.test/console/credentials?kind=model";
const card = { reason: "no_access" as const, engine: "Grok", botId: "bot-1", ownerPrincipalId: OWNER, botName: "Scout" };

afterEach(() => setLocale("en"));

describe("the access card: who pays (#1137)", () => {
  it("each person pays: says so, names the bot, and offers to choose a model", () => {
    const bobs = { ...card, payer: "speaker" as const, payerPrincipalId: BOB, cause: "no_credentials" as const, keysUrl: KEYS, subscriptionSignIn: true as const, speakerPays: true as const };
    expect(accessCardLines(bobs, { principalId: BOB, admin: false })).toEqual({
      text: "Replies from Scout are paid by the person who writes, and you don't have Grok access: connect your Grok subscription, add your key in Perspicax, or choose a model you can pay for.",
      link: { href: KEYS, label: "Add my key in Perspicax" },
      signIn: true,
      chooseModel: true,
    });
    const html = renderToStaticMarkup(createElement(AccessCard, { access: bobs, viewer: { principalId: BOB, admin: false }, onSignIn: () => {} }));
    expect(html).toContain("data-access-choose-model");
    expect(html).toContain("Choose a model");
    expect(html).toContain(`href="${KEYS}"`);
    const notGiven = { ...bobs, cause: "server_engine_not_allowed" as const };
    expect(accessCardLines(notGiven, { principalId: BOB, admin: false })).toMatchObject({ chooseModel: true, text: expect.stringContaining("Replies from Scout are paid by the person who writes") });
  });

  it("#1533 / #1759: an expired sign-in of the person's own subscription offers Reconnect, in their language", () => {
    const expired = { ...card, engine: "Claude", payer: "speaker" as const, payerPrincipalId: BOB, cause: "sign_in_expired" as const, subscriptionSignIn: true as const };
    expect(accessCardLines(expired, { principalId: BOB, admin: false })).toEqual({
      text: "Your Claude sign-in has expired, so Scout could not answer. Reconnect Claude to continue.",
      signIn: true,
      signInLabel: "Reconnect Claude",
    });
    const html = renderToStaticMarkup(createElement(AccessCard, { access: expired, viewer: { principalId: BOB, admin: false }, onSignIn: () => {} }));
    expect(html).toContain("data-access-sign-in");
    expect(html).toContain("Reconnect Claude");
    expect(html).not.toContain("OAuth");
    setLocale("fr");
    expect(accessCardLines(expired, { principalId: BOB, admin: false })).toMatchObject({ signInLabel: "Reconnecter Claude", text: expect.stringContaining("Ta connexion Claude a expiré") });
    // #1759: Codex and Grok use the same card and i18n keys
    for (const engine of ["Codex", "Grok"] as const) {
      setLocale("en");
      expect(accessCardLines({ ...expired, engine }, { principalId: BOB, admin: false })).toMatchObject({
        signIn: true, signInLabel: `Reconnect ${engine}`, text: expect.stringContaining(`Reconnect ${engine}`),
      });
      setLocale("fr");
      expect(accessCardLines({ ...expired, engine }, { principalId: BOB, admin: false })).toMatchObject({
        signInLabel: `Reconnecter ${engine}`, text: expect.stringContaining(`Ta connexion ${engine} a expiré`),
      });
    }
    // someone else reading the bot does not get the button
    setLocale("en");
    expect(accessCardLines(expired, { principalId: OWNER, admin: false })).not.toHaveProperty("signIn");
  });

  it("the owner's own bot, or a card from before: no choose-a-model offer", () => {
    const owners = { ...card, payer: "owner" as const, payerPrincipalId: OWNER, cause: "no_credentials" as const, keysUrl: KEYS };
    expect(accessCardLines(owners, { principalId: OWNER, admin: false })).not.toHaveProperty("chooseModel");
  });

  it("the owner pays and their computer is offline: one line with the owner's name, for the person who wrote", () => {
    const offline = { ...card, payer: "owner" as const, payerPrincipalId: OWNER, cause: "owner_model_offline" as const, ownerPays: true as const, speakerPrincipalId: BOB, ownerName: "Ada" };
    expect(accessCardLines(offline, { principalId: BOB, admin: false })).toEqual({ text: "Ada's model isn't reachable right now." });
    expect(accessCardLines(offline, { principalId: OWNER, admin: false })).toEqual({ text: "Ada's model isn't reachable right now." });
    expect(accessCardLines({ ...offline, ownerName: undefined }, { principalId: BOB, admin: false })).toEqual({ text: "The owner's model isn't reachable right now." });
    setLocale("fr");
    expect(accessCardLines(offline, { principalId: BOB, admin: false })?.text).toBe("Le modèle d'Ada n'est pas joignable en ce moment.");
  });

  it("the owner pays and lacks access: the person who wrote reads that the owner pays; the owner reads what to do", () => {
    const refused = { ...card, payer: "owner" as const, payerPrincipalId: OWNER, cause: "no_credentials" as const, ownerPays: true as const, speakerPrincipalId: BOB, keysUrl: KEYS };
    expect(accessCardLines(refused, { principalId: BOB, admin: false })).toEqual({ text: "Scout's owner pays for its replies, and their Grok access isn't available right now." });
    expect(accessCardLines(refused, { principalId: OWNER, admin: false })).toMatchObject({
      text: "You pay for Scout's replies to everyone who writes to it, and you don't have Grok access: connect your Grok subscription or add your key in Perspicax.",
      link: { href: KEYS, label: "Add my key in Perspicax" },
    });
    expect(accessCardLines({ ...refused, cause: "payer_disabled" as const }, { principalId: BOB, admin: false })).toEqual({ text: "Scout's owner pays for its replies, and their account is disabled." });
  });
});

// #1545: a bot asks the person to sign in to an engine it set up for them
describe("the access card: a bot's sign-in request (#1545)", () => {
  it("names the bot and the account, and offers the sign-in button", () => {
    const signIn = { reason: "sign_in" as const, engine: "Work account", instanceId: "claude-2", botId: "bot-1", botName: "Scout", ownerPrincipalId: OWNER, payerPrincipalId: OWNER };
    expect(accessCardLines(signIn, { principalId: OWNER, admin: false })).toEqual({
      text: "Scout asks you to sign in to Work account. You sign in yourself; the bot never sees your sign-in.",
      signIn: true,
    });
    const html = renderToStaticMarkup(createElement(AccessCard, { access: signIn, viewer: { principalId: OWNER, admin: false }, onSignIn: () => {} }));
    expect(html).toContain("data-access-sign-in");
  });
});
