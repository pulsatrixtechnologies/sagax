// #4507: the records a tool result names feed the conversation's seen list
// and give the bot one ready-made line; the end of the turn links a plain
// number the conversation read for exactly one kind and turns a link the
// person's product list does not know into text. Invented names only.
import { describe, expect, it } from "vitest";

import { parsePersonProducts } from "../../shared/person-products.ts";
import type { RecordsMetaGroup } from "../../shared/record-cards.ts";
import { createRecordLinks } from "./record-links.ts";
import { SEEN_RECORDS_PER_CONVERSATION, SeenRecords } from "./seen-records.ts";

const products = parsePersonProducts([
  { id: "nimbus_desk", name: "Nimbus Desk", state: "connected", records: [
    { kind: "ticket", name: { en: "Ticket", fr: "Billet" }, plural: { en: "Tickets", fr: "Billets" } },
    { kind: "project", name: { en: "Project", fr: "Projet" } },
  ] },
  { id: "plain_tool", name: "Plain Tool", state: "connected" },
]);
const ticket = (...ids: string[]): RecordsMetaGroup => ({ product: "nimbus_desk", kind: "ticket", records: ids.map((id) => ({ id, label: `#${id}` })), more: 0 });
const turn = (generation = "g1", threadId = "t1", principalId = "p-ada") => ({ threadId, generation, principalId });

function harness(list: typeof products | null = products) {
  const seen = new SeenRecords();
  const reads: string[] = [];
  const links = createRecordLinks({ seen, products: async (principalId) => { reads.push(principalId); return list; } });
  return { seen, links, reads };
}

describe("records in a tool result", () => {
  it("gives the bot one line with the ready-made link, read with the person's own list", async () => {
    const h = harness();
    expect(await h.links.onRecords(turn(), [ticket("297048")])).toBe("Mention it as [#297048](sagax://record/nimbus_desk/ticket/297048).");
    expect(h.reads).toEqual(["p-ada"]);
    expect(h.seen.of("p-ada", "t1")).toEqual([{ product: "nimbus_desk", kind: "ticket", id: "297048", label: "#297048" }]);
  });

  it("gives the several-records line once per kind and turn", async () => {
    const h = harness();
    expect(await h.links.onRecords(turn("g1"), [ticket("1", "2")])).toBe("Mention one of these as [#<id>](sagax://record/nimbus_desk/ticket/<id>).");
    expect(await h.links.onRecords(turn("g1"), [ticket("3", "4")])).toBeNull();
    expect(await h.links.onRecords(turn("g2"), [ticket("5", "6")])).not.toBeNull();
    expect(h.seen.of("p-ada", "t1").map((item) => item.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("adds nothing for a kind or a product the person's list does not describe, or when the list cannot be read", async () => {
    const h = harness();
    expect(await h.links.onRecords(turn(), [{ product: "plain_tool", kind: "ticket", records: [{ id: "1", label: "#1" }], more: 0 }])).toBeNull();
    expect(await h.links.onRecords(turn(), [{ product: "nimbus_desk", kind: "alert", records: [{ id: "1", label: "#1" }], more: 0 }])).toBeNull();
    expect(h.seen.of("p-ada", "t1")).toEqual([]);
    const none = harness(null);
    expect(await none.links.onRecords(turn(), [ticket("297048")])).toBeNull();
  });

  it("keeps what a conversation saw per person and conversation, at most 500", async () => {
    const h = harness();
    await h.links.onRecords(turn("g1", "t1", "p-ada"), [ticket("111111")]);
    await h.links.onRecords(turn("g1", "t2", "p-ada"), [ticket("222222")]);
    await h.links.onRecords(turn("g1", "t1", "p-ben"), [ticket("333333")]);
    expect(h.seen.of("p-ada", "t1").map((item) => item.id)).toEqual(["111111"]);
    expect(h.seen.of("p-ben", "t1").map((item) => item.id)).toEqual(["333333"]);
    const many = Array.from({ length: SEEN_RECORDS_PER_CONVERSATION + 20 }, (_, i) => String(500000 + i));
    for (let at = 0; at < many.length; at += 50) h.seen.add("p-ada", "t3", [ticket(...many.slice(at, at + 50))]);
    const kept = h.seen.of("p-ada", "t3");
    expect(kept).toHaveLength(SEEN_RECORDS_PER_CONVERSATION);
    expect(kept[0]!.id).toBe(many[20]);
    h.seen.forgetThread("t3");
    expect(h.seen.of("p-ada", "t3")).toEqual([]);
  });
});

describe("the end of a bot's turn", () => {
  it("links a number the conversation read, and keeps no record content", async () => {
    const h = harness();
    await h.links.onRecords(turn(), [ticket("297048", "4821")]);
    const reply = h.links.finishReply("J'ai fermé le billet 297048 et le billet 4821; 297049 reste ouvert.", "p-ada", "t1");
    expect(reply).toBe("J'ai fermé le billet [297048](sagax://record/nimbus_desk/ticket/297048) et le billet [4821](sagax://record/nimbus_desk/ticket/4821); 297049 reste ouvert.");
    // another person's or another conversation's reply links nothing
    expect(h.links.finishReply("billet 297048", "p-ben", "t1")).toBe("billet 297048");
    expect(h.links.finishReply("billet 297048", "p-ada", "t2")).toBe("billet 297048");
  });

  it("does not link an id the conversation read for two kinds", async () => {
    const h = harness();
    await h.links.onRecords(turn(), [ticket("555123"), { product: "nimbus_desk", kind: "project", records: [{ id: "555123", label: "Migration" }], more: 0 }]);
    expect(h.links.finishReply("Le 555123 est prêt.", "p-ada", "t1")).toBe("Le 555123 est prêt.");
  });

  it("turns a link the person's list does not know into its text, and keeps a known one", async () => {
    const h = harness();
    h.links.noteProducts("p-ada", products);
    const text = "[#1](sagax://record/nimbus_desk/ticket/1) et [#2](sagax://record/plain_tool/ticket/2) et [#3](sagax://record/nimbus_desk/alert/3)";
    expect(h.links.finishReply(text, "p-ada", "t1")).toBe("[#1](sagax://record/nimbus_desk/ticket/1) et #2 et #3");
    // a person whose list was never read: no record link survives
    expect(h.links.finishReply(text, "p-ben", "t1")).toBe("#1 et #2 et #3");
    expect(h.links.finishReply("Rien à lier.", null, "t1")).toBe("Rien à lier.");
  });
});
