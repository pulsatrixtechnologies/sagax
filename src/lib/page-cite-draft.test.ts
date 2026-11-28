import { describe, expect, it, beforeEach } from "vitest";

import {
  clearPageCiteDraft,
  forgetPageCiteDrafts,
  pageCiteDraft,
  setPageCiteDraft,
  takePageCiteDraft,
} from "./page-cite-draft";

const selection = {
  kind: "text" as const,
  quote: "Le volume a augmente",
  prefix: "Avant ",
  suffix: " apres",
  path: "body > p",
  tag: "p",
};

describe("page cite draft (#5464)", () => {
  beforeEach(() => forgetPageCiteDrafts());

  it("parks one passage per conversation and replaces it", () => {
    setPageCiteDraft("t1", { pageId: "p1", title: "Rapport", selection });
    expect(pageCiteDraft("t1")?.selection.quote).toBe("Le volume a augmente");
    setPageCiteDraft("t1", { pageId: "p1", title: "Rapport", version: 2, selection: { ...selection, quote: "Autre" } });
    expect(pageCiteDraft("t1")).toEqual({ pageId: "p1", title: "Rapport", version: 2, selection: { ...selection, quote: "Autre" } });
    expect(pageCiteDraft("t2")).toBeNull();
  });

  it("clears and takes with restore for a failed send", () => {
    setPageCiteDraft("t1", { pageId: "p1", title: "Rapport", selection });
    clearPageCiteDraft("t1");
    expect(pageCiteDraft("t1")).toBeNull();

    setPageCiteDraft("t1", { pageId: "p1", title: "Rapport", selection });
    const taken = takePageCiteDraft("t1")!;
    expect(taken.draft.pageId).toBe("p1");
    expect(pageCiteDraft("t1")).toBeNull();
    taken.restore();
    expect(pageCiteDraft("t1")?.selection.quote).toBe("Le volume a augmente");
  });

  it("restore leaves a newer cite alone", () => {
    setPageCiteDraft("t1", { pageId: "p1", title: "Rapport", selection });
    const taken = takePageCiteDraft("t1")!;
    setPageCiteDraft("t1", { pageId: "p2", title: "Autre", selection: { ...selection, quote: "Nouveau" } });
    taken.restore();
    expect(pageCiteDraft("t1")?.pageId).toBe("p2");
  });
});
