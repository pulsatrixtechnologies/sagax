// The parsers of the record windows of the other plugins (M-20261127-141,
// M-20261127-146): tolerant (an unknown field dropped, a line without its key
// words skipped), and never a value the console did not send.
import { describe, expect, it } from "vitest";
import {
  parseBackupView, parseCall, parseFacts, parseFolderItem, parseFolderView, parseLines, parseMessage, parseNote, parsePageView,
  parsePostStats, parsePostView, parseReply, parseRestorePoint, parseThreatView, smsSegments,
} from "./record-plugin-views";

describe("shared parts", () => {
  it("keeps a fact with its label and value only, its code, tone and record when valid", () => {
    expect(parseFacts([
      { label: "Path", value: "C:\\Users\\", code: true, extra: "dropped" },
      { label: "Signature", value: "None", tone: "alert" },
      { label: "Endpoint", value: "ACME-PC-014", ref: { product: "sentinelone", kind: "agent", id: "77001" } },
      { label: "Bad ref", value: "x", ref: { product: "S", kind: "agent", id: "1" } },
      { label: "", value: "no label" },
      { label: "No value" },
      { label: "Unknown tone", value: "y", tone: "purple" },
    ])).toEqual([
      { label: "Path", value: "C:\\Users\\", code: true },
      { label: "Signature", value: "None", tone: "alert" },
      { label: "Endpoint", value: "ACME-PC-014", ref: { product: "sentinelone", kind: "agent", id: "77001" } },
      { label: "Bad ref", value: "x" },
      { label: "Unknown tone", value: "y" },
    ]);
  });

  it("never puts a GUID on screen: a fact or a tile shaped like one is left out", () => {
    const guid = "6f1c2a52-3b7e-4f0a-9d51-0c7a8e1b2d34";
    expect(parseFacts([{ label: "Agent id", value: guid }, { label: "Name", value: "ACME-PC-014" }])).toEqual([{ label: "Name", value: "ACME-PC-014" }]);
    expect(parseThreatView({ view: { device_tiles: [{ label: "Site", value: guid }] } })?.deviceTiles).toEqual([]);
  });

  it("reads a list section's lines, skipping the ones without their key words", () => {
    expect(parseLines({ lines: [{ id: "n1", author: "Ada", text: "Hello" }, { id: "n2", author: "Ada" }, "junk"] }, parseNote)).toEqual([{ id: "n1", author: "Ada", text: "Hello" }]);
    expect(parseLines(undefined, parseNote)).toEqual([]);
    expect(parseLines({ lines: "not a list" }, parseNote)).toEqual([]);
  });
});

describe("a threat", () => {
  it("reads its verdict, what was done, the tree, the file and the endpoint", () => {
    const view = parseThreatView({ view: {
      verdict: { label: "Malicious", tone: "alert", detail: "High confidence" },
      done: ["Quarantined", 3, "Process killed"],
      tree: [{ depth: 0, name: "explorer.exe" }, { depth: 12, name: "deep.exe", tone: "alert" }, { depth: 1 }],
      file: [{ label: "Name", value: "invoice.pdf.exe" }],
      device: { name: "ACME-PC-014", isolated: true, state: { label: "Isolated", tone: "waiting" } },
      device_tiles: [{ label: "Agent", value: "24.1.4", detail: "up to date" }],
    } });
    expect(view).toEqual({
      verdict: { label: "Malicious", tone: "alert", detail: "High confidence" },
      done: ["Quarantined", "3", "Process killed"],
      tree: [{ depth: 0, name: "explorer.exe" }, { depth: 8, name: "deep.exe", tone: "alert" }],
      file: [{ label: "Name", value: "invoice.pdf.exe" }],
      device: { name: "ACME-PC-014", isolated: true, state: { label: "Isolated", tone: "waiting" } },
      deviceTiles: [{ label: "Agent", value: "24.1.4", detail: "up to date" }],
      deviceFacts: [],
    });
  });

  it("is absent when the console sends no view", () => {
    expect(parseThreatView(undefined)).toBeUndefined();
    expect(parseThreatView({ lines: [] })).toBeUndefined();
  });
});

describe("a protected system", () => {
  it("reads its tiles, days, volumes and vault; a share out of 0 to 100 is no bar", () => {
    const view = parseBackupView({ view: {
      tiles: [{ label: "Last backup", value: "42 min ago" }],
      days: [{ day: "Nov 12", tone: "alert", label: "Failed" }, { day: "Nov 13", tone: "weird" }, { tone: "done" }],
      failure: "Nov 12",
      volumes: [{ name: "C:", used: "82 GB of 120 GB", share: 68 }, { name: "D:", used: "410 GB of 1 TB", share: 140 }, { name: "E:" }],
      vault: [{ label: "Copy", value: "Cloud" }],
    } });
    expect(view?.days).toEqual([{ day: "Nov 12", tone: "alert", label: "Failed" }, { day: "Nov 13", tone: "open" }]);
    expect(view?.volumes).toEqual([{ name: "C:", used: "82 GB of 120 GB", share: 68 }, { name: "D:", used: "410 GB of 1 TB" }]);
    expect(view?.failure).toBe("Nov 12");
    expect(parseRestorePoint({ id: "rp1", when: "Nov 27, 1:30 PM", kind: "Incremental", verified: true })).toEqual({ id: "rp1", when: "Nov 27, 1:30 PM", kind: "Incremental", verified: true });
    expect(parseRestorePoint({ kind: "Incremental" })).toBeNull();
  });
});

describe("a page", () => {
  it("needs a body, keeps an https edit address only", () => {
    expect(parsePageView({ view: { path: [] } })).toBeUndefined();
    const view = parsePageView({ view: { body: "## Every week", book: [{ label: "Backups", depth: 0 }, { label: "Procedure", depth: 1, current: true }], tags: ["backup"], edit_url: "https://docs.example/p/edit" } });
    expect(view).toMatchObject({ body: "## Every week", tags: ["backup"], editUrl: "https://docs.example/p/edit" });
    expect(view?.book).toEqual([{ label: "Backups", depth: 0 }, { label: "Procedure", depth: 1, current: true }]);
    expect(parsePageView({ view: { body: "x", edit_url: "javascript:alert(1)" } })?.editUrl).toBeUndefined();
    expect(parsePageView({ view: { body: "x", edit_url: "http://docs.example/p" } })?.editUrl).toBeUndefined();
  });
});

describe("a conversation", () => {
  it("reads a message the Twilio way, its error with its cause and fix", () => {
    const message = parseMessage({
      id: "SM6f3e12d0", direction: "out", body: "Your invoice is late", when: "11:00 AM", day: "Today", status: "Undelivered", tone: "alert", state: "undelivered",
      from: "+1 819 555-0100", to: "+1 418 555-0142", price: "$0.0079 USD",
      error: { code: "30007", title: "Filtered by the carrier", cause: "Looks like spam.", fix: "Send it without the link." },
      life: [{ text: "Accepted", when: "11:00:00", tone: "done" }],
    });
    expect(message).toMatchObject({ id: "SM6f3e12d0", direction: "out", tone: "alert", day: "Today", error: { code: "30007", fix: "Send it without the link." } });
    expect(message?.life).toEqual([{ text: "Accepted", when: "11:00:00", tone: "done" }]);
    expect(parseMessage({ id: "SM1", direction: "sideways", from: "+1" })?.direction).toBe("out");
    expect(parseMessage({ id: "SM1" })).toBeNull();
    expect(parseMessage({ id: "S M", from: "+1" })).toBeNull();
    expect(parseCall({ id: "CA1", when: "Nov 26", direction: "in", recording: "yes" })).toEqual({ id: "CA1", when: "Nov 26", direction: "in" });
  });

  it("counts an SMS's segments as Twilio does", () => {
    expect(smsSegments("")).toMatchObject({ chars: 0, segments: 0, encoding: "GSM-7" });
    expect(smsSegments("a".repeat(160))).toMatchObject({ segments: 1, per: 160, encoding: "GSM-7" });
    expect(smsSegments("a".repeat(161))).toMatchObject({ segments: 2, per: 153 });
    expect(smsSegments("€")).toMatchObject({ chars: 2, encoding: "GSM-7" });
    expect(smsSegments("Ça va ? 🙂")).toMatchObject({ encoding: "UCS-2", segments: 1, per: 70 });
    expect(smsSegments("é".repeat(70) + "ç")).toMatchObject({ encoding: "UCS-2", segments: 2, per: 67 });
  });
});

describe("a post", () => {
  it("needs its author, drops the @ of a handle, keeps the counts as sent", () => {
    expect(parsePostView({ view: { text: "Hi" } })).toBeUndefined();
    const view = parsePostView({ view: { author: { name: "Nimbus MSP", handle: "@nimbus_msp", verified: true }, when: "Nov 25", text: "Tested? #IT", counts: { likes: "38", views: "12.4K", junk: 1 } } });
    expect(view).toMatchObject({ author: { name: "Nimbus MSP", handle: "nimbus_msp", verified: true }, counts: { likes: "38", views: "12.4K" } });
    expect(view?.counts).not.toHaveProperty("junk");
    expect(parseReply({ id: "1", author: { name: "Lina", handle: "lina" }, text: "Same here", in_reply_to: "@nimbus_msp" })?.inReplyTo).toBe("nimbus_msp");
    expect(parseReply({ id: "1", author: { name: "Lina", handle: "lina" } })).toBeNull();
    expect(parsePostStats({ view: { hourly: [{ label: "1 h", value: 3.1 }, { label: "2 h", value: -1 }], sources: [{ label: "For you", share: 62 }, { label: "Odd", share: 120 }] } }))
      .toEqual({ hourly: [{ label: "1 h", value: 3.1 }], sources: [{ label: "For you", share: 62 }] });
    expect(parsePostStats({ view: {} })).toBeUndefined();
  });
});

describe("a folder", () => {
  it("reads its places, items and tags; a file's type comes from its name when not sent", () => {
    const view = parseFolderView({ view: { path: [{ label: "Share" }, { label: "Acme" }], places: [{ group: "tags", label: "Urgent", tag: "red" }, { group: "odd", label: "Elsewhere" }, { group: "tags", label: "Bad", tag: "pink" }] } });
    expect(view?.places).toEqual([{ group: "tags", label: "Urgent", tag: "red" }, { group: "locations", label: "Elsewhere" }, { group: "tags", label: "Bad" }]);
    expect(parseFolderItem({ id: "f1", name: "contract.pdf", size: "412 KB" })).toEqual({ id: "f1", name: "contract.pdf", folder: false, ext: "PDF", size: "412 KB" });
    expect(parseFolderItem({ id: "d1", name: "Contracts", folder: true, ext: "pdf" })).toEqual({ id: "d1", name: "Contracts", folder: true });
    expect(parseFolderItem({ name: "no id" })).toBeNull();
  });
});
