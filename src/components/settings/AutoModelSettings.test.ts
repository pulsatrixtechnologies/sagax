import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AutoModelStatus } from "./AutoModelSettings";
import type { AutoModelPreview } from "../../../shared/auto-model";

const status: AutoModelPreview = { auto: true, pick: null, backups: [], chain: [
  { instanceId: "first", engineLabel: "My subscription", model: "large", modelLabel: "Large" },
  { instanceId: "second", engineLabel: "My computer", model: "small", modelLabel: "Small" },
], excluded: [
  { instanceId: "third", engineLabel: "Offline provider", reason: "offline" },
  { instanceId: "first", engineLabel: "My subscription", model: "old", modelLabel: "Old", reason: "modelOff" },
] };

describe("the Auto dispatch preview", () => {
  it("shows the server's ordered chain and exclusion reasons", () => {
    const html = renderToStaticMarkup(createElement(AutoModelStatus, { status }));
    expect(html.indexOf("Large")).toBeLessThan(html.indexOf("Small"));
    expect(html).toContain("data-auto-model-excluded");
    expect(html).toContain("Offline provider");
    expect(html).toContain("Old");
    expect(html).toContain("Model turned off");
    expect(html).not.toContain("/api/");
  });
  it("draws rows of the group's card: no title again, no raw details, folds behind count pills", () => {
    const html = renderToStaticMarkup(createElement(AutoModelStatus, { status }));
    expect(html).not.toContain("What Auto would choose now");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<select");
    expect(html.match(/data-count-pill/g)?.length).toBe(2);
    expect(html).toContain("Left out");
  });
  it("says when no model is eligible instead of presenting a base that cannot run", () => {
    const html = renderToStaticMarkup(createElement(AutoModelStatus, { status: { ...status, chain: [] } }));
    expect(html).toContain("No active model");expect(html).not.toContain("data-auto-model-chain");
  });
  // M-20261126-101, review M1b and N1: every account at its usage limit (Auto's
  // `limited`, the menu's reading); the server then sends no order of choice
  const atLimit = (until: number | null): AutoModelPreview["modes"] => ({ auto: { mode: "auto", pick: null, limited: { until } } } as AutoModelPreview["modes"]);
  it("names no model as Auto's choice while every account is at its limit, and says when one is back", () => {
    const until = Date.now() + 2 * 60 * 60 * 1000;
    const html = renderToStaticMarkup(createElement(AutoModelStatus, { status: { ...status, chain: [], modes: atLimit(until), excluded: [
      { instanceId: "first", engineLabel: "My subscription", reason: "limit" },
      { instanceId: "second", engineLabel: "My computer", reason: "limit" },
    ] } }));
    expect(html).not.toContain("data-auto-model-chain");
    expect(html).not.toContain("Large");
    expect(html).toContain("No model you can use right now · resets ");
    expect(html).not.toContain("No active model");
    expect(html.match(/Usage limit reached for this account/g)?.length).toBe(2);
  });
  it("says only that no model can be used when the reset is not known", () => {
    const html = renderToStaticMarkup(createElement(AutoModelStatus, { status: { ...status, chain: [], modes: atLimit(null) } }));
    expect(html).toContain("No model you can use right now");
    expect(html).not.toContain("resets");
  });
  it("identifies a preview still loading", () => {
    expect(renderToStaticMarkup(createElement(AutoModelStatus, { status: null }))).toContain('role="status"');
  });
});
