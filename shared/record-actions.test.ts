// M-20261127-191: a ticket's note.add must set its kind; a company's or a contact's may omit it.
// The writes of the record windows of the other plugins (M-20261127-141,
// M-20261127-146): each accepted with only its own fields, in their bounds.
import { describe, expect, it } from "vitest";

import { RECORD_MESSAGE_MAX, parseRecordAction, parseRecordActions } from "./record-actions.ts";

describe("note.add and the record's kind", () => {
  it("requires kind on a ticket (discussion, internal or resolution)", () => {
    expect(parseRecordAction({ action: "note.add", set: { text: "Rouleau remplacé" } }, "ticket")).toBeNull();
    expect(parseRecordAction({ action: "note.add", set: { text: "Rouleau remplacé", kind: "internal" } }, "ticket"))
      .toEqual({ action: "note.add", set: { text: "Rouleau remplacé", kind: "internal" } });
  });

  it("takes a company's note with its words only", () => {
    expect(parseRecordAction({ action: "note.add", set: { text: "  Relancer en janvier  " } }, "company"))
      .toEqual({ action: "note.add", set: { text: "Relancer en janvier" } });
  });

  it("takes a contact's note with its words only", () => {
    expect(parseRecordAction({ action: "note.add", set: { text: "Préférer le matin" } }, "contact"))
      .toEqual({ action: "note.add", set: { text: "Préférer le matin" } });
  });
});

describe("the other plugins' writes", () => {
  it("takes a threat's changes undone, its endpoint isolated or reconnected, with nothing to set", () => {
    for (const action of ["threat.rollback", "threat.isolate", "threat.reconnect", "backup.run", "post.pin", "post.unpin", "post.remove"]) {
      expect(parseRecordAction({ action })).toEqual({ action, set: {} });
      expect(parseRecordAction({ action, id: "1" })).toBeNull();
      expect(parseRecordAction({ action, set: { extra: "x" } })).toBeNull();
    }
  });

  it("takes a verdict of the two the person gives", () => {
    expect(parseRecordAction({ action: "threat.verdict", set: { verdict: "false_positive" } })).toEqual({ action: "threat.verdict", set: { verdict: "false_positive" } });
    expect(parseRecordAction({ action: "threat.verdict", set: { verdict: "suspicious" } })).toBeNull();
    expect(parseRecordAction({ action: "threat.verdict" })).toBeNull();
  });

  it("takes an SMS of one to ten segments of text", () => {
    expect(parseRecordAction({ action: "message.send", set: { text: "  Yes, 3:30 PM works.  " } })).toEqual({ action: "message.send", set: { text: "Yes, 3:30 PM works." } });
    expect(parseRecordAction({ action: "message.send", set: { text: "   " } })).toBeNull();
    expect(parseRecordAction({ action: "message.send", set: { text: "a".repeat(RECORD_MESSAGE_MAX + 1) } })).toBeNull();
    expect(parseRecordAction({ action: "message.send", set: { text: "Hi", to: "+15555550100" } })).toBeNull();
  });

  it("takes a reply to the post or to one of its replies", () => {
    expect(parseRecordAction({ action: "post.reply", set: { text: "Thanks!" } })).toEqual({ action: "post.reply", set: { text: "Thanks!" } });
    expect(parseRecordAction({ action: "post.reply", set: { text: "Thanks!", to: "1861500000001" } })).toEqual({ action: "post.reply", set: { text: "Thanks!", to: "1861500000001" } });
    expect(parseRecordAction({ action: "post.reply", set: { text: "Thanks!", to: "@lina" } })).toBeNull();
  });

  it("keeps the new writes in a console's list of the ones it takes", () => {
    expect([...parseRecordActions(["threat.isolate", "message.send", "unknown.write"])!]).toEqual(["threat.isolate", "message.send"]);
  });
});
