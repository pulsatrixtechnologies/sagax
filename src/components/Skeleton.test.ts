import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { SkeletonRows } from "./Skeleton";

describe("SkeletonRows (#2595)", () => {
  it("keeps the label in a status region and draws one row per item", () => {
    const html = renderToStaticMarkup(createElement(SkeletonRows, { label: "Loading files…", rows: 4 }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading files…");
    expect(html.match(/size-7/g)).toHaveLength(4);
  });

  it("holds still under reduced motion and animates opacity only", () => {
    const html = renderToStaticMarkup(createElement(SkeletonRows, { label: "x", variant: "card" }));
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).toContain("animate-pulse");
    expect(html).toContain("rounded-xl bg-card");
  });
});
