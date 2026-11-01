import { describe, expect, it } from "vitest";

import {
  pageBesideChat,
  pageCardOpenVersion,
  pageCardStatusWithThreadLatest,
  pageCoversChat,
  pageHostIsWide,
  pageStageComposer,
  PAGE_CHAT_SIDE_MIN_PX,
  PAGE_CHAT_SURFACE_DEFAULT,
} from "./page-chat-layout";

describe("page + chat layout", () => {
  it("defaults to stage (measured HTML file path): cover, no side transcript", () => {
    expect(PAGE_CHAT_SURFACE_DEFAULT).toBe("stage");
    expect(pageBesideChat(true, true, "stage")).toBe(false);
    expect(pageCoversChat(true, true, "stage")).toBe(true);
    expect(pageCoversChat(true, false, "stage")).toBe(true);
    expect(pageStageComposer(true, "stage")).toBe(true);
    expect(pageStageComposer(true, "beside")).toBe(false);
  });

  it("optional beside only when asked and the host is wide", () => {
    expect(pageBesideChat(true, true, "beside")).toBe(true);
    expect(pageBesideChat(true, false, "beside")).toBe(false);
    expect(pageBesideChat(false, true, "beside")).toBe(false);
    expect(pageCoversChat(true, false, "beside")).toBe(true);
    expect(pageCoversChat(true, true, "beside")).toBe(false);
  });

  it("keeps the 768px host side minimum", () => {
    expect(PAGE_CHAT_SIDE_MIN_PX).toBe(768);
    expect(pageHostIsWide(767)).toBe(false);
    expect(pageHostIsWide(768)).toBe(true);
    expect(pageHostIsWide(400)).toBe(false);
    expect(pageHostIsWide(1400)).toBe(true);
  });

  it("opens the latest page from an Updated-below card, and the card's version otherwise", () => {
    expect(pageCardOpenVersion("superseded", 1)).toBeUndefined();
    expect(pageCardOpenVersion("proposed", 2)).toBe(2);
    expect(pageCardOpenVersion("published", 3)).toBe(3);
    expect(pageCardOpenVersion("draft", 1)).toBe(1);
    expect(pageCardOpenVersion(null, 1)).toBe(1);
  });

  it("flips a mounted card to Updated below when the thread names a newer version", () => {
    expect(pageCardStatusWithThreadLatest("draft", 1, 2)).toBe("superseded");
    expect(pageCardStatusWithThreadLatest("proposed", 1, 2)).toBe("superseded");
    expect(pageCardStatusWithThreadLatest("published", 2, 2)).toBe("published");
    expect(pageCardStatusWithThreadLatest("declined", 1, 2)).toBe("declined");
    expect(pageCardStatusWithThreadLatest("deleted", 1, 2)).toBe("deleted");
    expect(pageCardStatusWithThreadLatest("draft", 1, undefined)).toBe("draft");
    expect(pageCardOpenVersion(pageCardStatusWithThreadLatest("draft", 1, 2), 1)).toBeUndefined();
  });
});
