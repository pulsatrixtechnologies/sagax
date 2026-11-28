// M-20261127-191: a ticket's note.add must set its kind; a company's or a contact's may omit it.
import { describe, expect, it } from "vitest";

import { parseRecordAction } from "./record-actions.ts";

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
