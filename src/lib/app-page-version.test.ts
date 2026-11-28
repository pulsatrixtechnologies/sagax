import { describe, expect, it } from "vitest";

import { appAtRev, appVersions } from "./app-page-version";

describe("appVersions / appAtRev", () => {
  it("maps history entries onto earlier revs", () => {
    const app = {
      v: 1 as const,
      html: "<p>2</p>",
      title: "Now",
      rev: 2,
      history: [
        { html: "<p>0</p>", title: "Start" },
        { html: "<p>1</p>" },
      ],
    };
    expect(appVersions(app)).toEqual({ first: 0, last: 2 });
    expect(appAtRev(app, 0)).toEqual({ html: "<p>0</p>", title: "Start" });
    expect(appAtRev(app, 1)).toEqual({ html: "<p>1</p>", title: "Now" });
    expect(appAtRev(app, 2)).toEqual({ html: "<p>2</p>", title: "Now" });
  });
});
