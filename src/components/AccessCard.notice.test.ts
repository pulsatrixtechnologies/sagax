// #3656: the "no access" notice is a row of the history, drawn like a bot's
// message, tied to the person's message that got no answer and to its time,
// and marked resolved once the access works again.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { accessNoticePlace } from "@/lib/access-notice";
import type { MyEngine } from "@/lib/perspicax-org";
import { formatTime, type Message } from "@/state/store";
import { AccessNoticeRow } from "./AccessCard";

const ME = "pr_member";
const viewer = { principalId: ME, admin: false };
const access = { reason: "no_access" as const, engine: "Claude", instanceId: "claude", botId: "b1", botName: "Helper", ownerPrincipalId: ME, payerPrincipalId: ME, cause: "no_credentials" as const, subscriptionSignIn: true as const };
const asked: Message = { id: "u1", role: "user", kind: "text", text: "Summarize the week", at: Date.UTC(2026, 10, 11, 14, 32) };
const card: Message = { id: "a1", role: "bot", kind: "access", access, at: asked.at + 2_000 };
const answer: Message = { id: "r1", role: "bot", kind: "text", text: "Here is the summary.", at: card.at + 600_000, turnRun: { instanceId: "claude", model: "sonnet" } };
const claude = (myTurns: MyEngine["myTurns"]): MyEngine => ({
  instanceId: "claude", driver: "claudeAgent", displayName: "Claude", installed: true,
  subscription: { supported: true, signedIn: myTurns === "subscription", ...(myTurns === "expired" ? { signedIn: true, expired: true } : {}) },
  myKey: false, orgKey: false, myTurns,
});

const row = (transcript: Message[], message: Message = card) =>
  renderToStaticMarkup(createElement(AccessNoticeRow, { message, transcript, viewer, onSignIn: () => {} }));

afterEach(() => setLocale("en"));

describe("the no access notice in the history (#3656)", () => {
  it("is drawn as a bot message tied to the message that failed, with its time, not as a box docked to the composer", () => {
    const html = row([asked, card]);
    expect(html).toContain("data-access-notice=\"open\"");
    expect(html).toContain("bg-bubble-bot");
    expect(html).not.toContain("border-accent/30");
    expect(html).toContain(`About your message at ${formatTime(asked.at)}`);
    expect(html).toContain("data-access-sign-in");
  });

  it("is marked resolved once the bot answered again, keeping its words and dropping its actions", () => {
    const html = row([asked, card, { ...asked, id: "u2", at: answer.at - 1_000 }, answer]);
    expect(html).toContain("data-access-notice=\"resolved\"");
    expect(html).toContain("Resolved: Claude access is back.");
    expect(html).toContain("You don&#x27;t have Claude access for this message");
    expect(html).not.toContain("data-access-sign-in");
    expect(html).not.toContain("data-access-add-key");
  });

  it("stays open when the bot answered on another engine: the card's access is not back", () => {
    const elsewhere: Message = { ...answer, turnRun: { instanceId: "codex", model: "gpt" } };
    expect(accessNoticePlace(card, [asked, card, elsewhere], null, ME).resolved).toBe(false);
    const html = row([asked, card, elsewhere]);
    expect(html).toContain("data-access-notice=\"open\"");
    expect(html).not.toContain("access is back");
    expect(html).toContain("data-access-sign-in");
    // a reply that does not say what it ran on proves nothing either
    expect(accessNoticePlace(card, [asked, card, { ...answer, turnRun: undefined }], null, ME).resolved).toBe(false);
    // a card without an instance id: its engine is the one whose name it carries
    const named: Message = { ...card, access: { ...access, instanceId: undefined } };
    expect(accessNoticePlace(named, [asked, named, answer], [claude("none")], ME).resolved).toBe(true);
    expect(accessNoticePlace(named, [asked, named, elsewhere], [claude("none")], ME).resolved).toBe(false);
  });

  it("is resolved as soon as the person's own engine runs their turns again, before any new message", () => {
    expect(accessNoticePlace(card, [asked, card], [claude("subscription")], ME)).toEqual({ failed: asked, laterAsks: 0, mine: true, resolved: true });
    expect(accessNoticePlace(card, [asked, card], [claude("key")], ME).resolved).toBe(true);
    expect(accessNoticePlace(card, [asked, card], [claude("expired")], ME).resolved).toBe(false);
    expect(accessNoticePlace(card, [asked, card], [claude("none")], ME).resolved).toBe(false);
    // someone else's card: the viewer's engine says nothing about it
    expect(accessNoticePlace(card, [asked, card], [claude("subscription")], "pr_other").resolved).toBe(false);
  });

  it("covers the person's later messages that got no answer either (the server writes the card once)", () => {
    const second: Message = { ...asked, id: "u2", text: "And the next one", at: card.at + 900_000 };
    const transcript = [asked, card, second];
    expect(accessNoticePlace(card, transcript, null, ME)).toEqual({ failed: asked, laterAsks: 1, mine: true, resolved: false });
    expect(row(transcript)).toContain(`About your 2 messages since ${formatTime(asked.at)}`);
    // an answer in between: the message after it is not this card's
    expect(accessNoticePlace(card, [asked, card, answer, { ...second, at: answer.at + 1 }], null, ME)).toEqual({ failed: asked, laterAsks: 0, mine: true, resolved: true });
  });

  it("ties each card to its own failed message when a thread holds two", () => {
    const second: Message = { ...asked, id: "u2", text: "And the next one", at: card.at + 60_000 };
    const card2: Message = { ...card, id: "a2", at: second.at + 2_000 };
    const transcript = [asked, card, second, card2];
    expect(accessNoticePlace(card2, transcript, null, ME)).toEqual({ failed: second, laterAsks: 0, mine: true, resolved: false });
  });

  it("a bot's sign-in request is settled by the sign-in, not by the bot's words that follow", () => {
    const signIn: Message = { ...card, access: { reason: "sign_in", engine: "Claude", instanceId: "claude", botId: "b1", botName: "Helper", ownerPrincipalId: ME, payerPrincipalId: ME } };
    expect(accessNoticePlace(signIn, [asked, signIn, answer], null, ME).resolved).toBe(false);
    expect(accessNoticePlace(signIn, [asked, signIn], [claude("subscription")], ME).resolved).toBe(true);
  });

  it("in a room, names only the card's person's message, never another member's in between", () => {
    const OTHER = "pr_other";
    const mineAsk: Message = { ...asked, sender: { name: "Member", id: ME } };
    const theirs: Message = { ...asked, id: "u9", text: "Something else", sender: { name: "Other", id: OTHER }, at: asked.at + 1_000 };
    const roomCard: Message = { ...card, access: { ...access, speakerPrincipalId: ME }, at: theirs.at + 1_000 };
    const later: Message = { ...theirs, id: "u10", at: roomCard.at + 60_000 };
    const transcript = [mineAsk, theirs, roomCard, later];
    expect(accessNoticePlace(roomCard, transcript, null, ME, true)).toEqual({ failed: mineAsk, laterAsks: 0, mine: true, resolved: false });
    // the server-proven request wins over the nearest message
    expect(accessNoticePlace({ ...roomCard, requestMessageId: "u1" }, [theirs, mineAsk, roomCard], null, ME, true).failed).toBe(mineAsk);
    // another viewer is never told "your": the card shows its own time
    expect(accessNoticePlace(roomCard, transcript, null, OTHER, true).mine).toBe(false);
    const html = renderToStaticMarkup(createElement(AccessNoticeRow, { message: roomCard, transcript, viewer: { principalId: OTHER, admin: false }, room: true }));
    expect(html).not.toContain("About your");
    expect(html).toContain(formatTime(roomCard.at));
  });

  it("in a room where each person pays, another member's answered turn on the same engine leaves the card open", () => {
    const OTHER = "pr_other";
    const mineAsk: Message = { ...asked, sender: { name: "Member", id: ME } };
    const roomCard: Message = { ...card, access: { ...access, payer: "speaker", speakerPrincipalId: ME }, requestMessageId: mineAsk.id };
    const theirAsk: Message = { ...asked, id: "u9", text: "Something else", sender: { name: "Other", id: OTHER }, at: roomCard.at + 1_000 };
    const theirAnswer: Message = { ...answer, requestMessageId: theirAsk.id, at: theirAsk.at + 1_000 };
    expect(accessNoticePlace(roomCard, [mineAsk, roomCard, theirAsk, theirAnswer], null, ME, true).resolved).toBe(false);
    // an answer with no request it names is not known to be the card's person's
    expect(accessNoticePlace(roomCard, [mineAsk, roomCard, theirAsk, { ...theirAnswer, requestMessageId: undefined }], null, ME, true).resolved).toBe(false);
    // the card's own person asked again and got an answer on that engine: settled
    const mineAgain: Message = { ...mineAsk, id: "u11", at: theirAnswer.at + 1_000 };
    const mineAnswer: Message = { ...answer, id: "r2", requestMessageId: mineAgain.id, at: mineAgain.at + 1_000 };
    expect(accessNoticePlace(roomCard, [mineAsk, roomCard, theirAsk, theirAnswer, mineAgain, mineAnswer], null, ME, true).resolved).toBe(true);
    // the owner pays: any answer on that engine is the owner's access back
    const ownerCard: Message = { ...roomCard, access: { ...roomCard.access!, payer: "owner", ownerPays: true } };
    expect(accessNoticePlace(ownerCard, [mineAsk, ownerCard, theirAsk, theirAnswer], null, ME, true).resolved).toBe(true);
  });

  it("a sign-in card the server writes on its own shows its own time, not a message above it", () => {
    const signIn: Message = { ...card, access: { reason: "sign_in", engine: "Claude", instanceId: "claude", botId: "b1", botName: "Helper", ownerPrincipalId: ME, payerPrincipalId: ME } };
    expect(accessNoticePlace(signIn, [asked, signIn], null, ME).failed).toBeUndefined();
    expect(row([asked, signIn], signIn)).not.toContain("About your");
  });

  it("speaks French", () => {
    setLocale("fr");
    const html = row([asked, card, answer]);
    expect(html).toContain(`À propos de ton message de ${formatTime(asked.at)}`);
    expect(html).toContain("Réglé : l&#x27;accès Claude est revenu.");
  });
});
