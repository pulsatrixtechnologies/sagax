import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import type { ResourceFrame, ResourceUsageSnapshot, ResourceUsageView } from "../../../shared/resource-usage";
import { setLocale } from "@/lib/i18n";
import { ResourceUsageBody } from "./ResourceUsageCard";
import { applyEvent, fullness, latest, niceRateMax, percentRange, seriesOf, stats } from "./resource-usage-model";

const UUID = "5f0c3e1a-9b7d-4c2e-8f6a-1d2b3c4d5e6f";
const view: ResourceUsageView = { samplerId: "ru_0123456789abcdef01", target: "remote-session", label: "Session à distance", hostLabel: "BQDHS7" };

function frames(count = 31): ResourceFrame[] {
  return Array.from({ length: count }, (_unused, index) => ({
    t: 1_000_000 + index * 2000,
    cpu: { total: 20 + (index % 5) * 10, cores: [60, 20, 10, 5] },
    mem: { used: 6.4 * 1024 ** 3, total: 16 * 1024 ** 3, swapUsed: 1024 ** 3, swapTotal: 4 * 1024 ** 3 },
    disk: { readBps: 2 * 1024 ** 2, writeBps: 512 * 1024 },
    net: { rxBps: 1.5 * 1024 ** 2, txBps: 200 * 1024 },
    volumes: [
      { name: "C:", used: 200 * 1024 ** 3, total: 476 * 1024 ** 3 },
      { name: "D:", used: 850 * 1024 ** 3, total: 954 * 1024 ** 3 },
    ],
  }));
}

const snapshot = (overrides: Partial<ResourceUsageSnapshot> = {}): ResourceUsageSnapshot => ({
  id: view.samplerId,
  state: "live",
  host: { hostname: "POSTE-01", os: "Microsoft Windows 11 Professionnel", uptimeSec: 3 * 86400 + 4 * 3600, cores: 4 },
  frames: frames(),
  endsAt: 1_000_000 + 60_000 + 4 * 60_000,
  ...overrides,
});

const render = (props: Partial<Parameters<typeof ResourceUsageBody>[0]> = {}) =>
  renderToStaticMarkup(createElement(ResourceUsageBody, { view, snapshot: snapshot(), scheme: "dark", now: 1_000_000 + 60_000, ...props }));

const visibleText = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

afterEach(() => setLocale("en"));

describe("usage card", () => {
  it("names the computer and folds numbers into readable units (fr)", () => {
    setLocale("fr");
    const text = visibleText(render());
    expect(text).toContain("POSTE-01");
    expect(text).toContain("Session à distance · Microsoft Windows 11 Professionnel · en marche depuis 3 j 4 h");
    expect(text).toContain("En direct");
    expect(text).toContain("6,4 Go");
    expect(text).toContain("sur 16 Go");
    expect(text).toContain("4 cœurs · max 60 %");
    expect(text).toContain("Lecture 2 Mo/s");
    expect(text).toContain("Reçu 1,5 Mo/s");
    expect(text).toContain("arrêt dans 4:00");
    // a nearly full volume says so in words, not only in color
    expect(text).toContain("Presque plein");
    expect(text).toContain("89 %");
  });

  it("keeps the live dot still for reduced motion and names the state at every width", () => {
    setLocale("fr");
    const html = render();
    expect(html).toContain("motion-safe:animate-pulse");
    expect(html).not.toMatch(/[" ]animate-pulse/);
    expect(html).not.toContain("sr-only");
    // the memory chart says the range it zooms on
    expect(visibleText(html)).toMatch(/\d+ % à \d+ %/);
  });

  it("reads in English too, with meters and labelled charts for screen readers", () => {
    setLocale("en");
    const html = render();
    expect(visibleText(html)).toContain("Storage");
    expect(html).toContain('role="meter"');
    expect(html).toMatch(/aria-label="CPU over the last minute: now \d+(\.\d)?%, peak 60%\."/);
  });

  it("shows the waiting state before the first sample", () => {
    setLocale("fr");
    const text = visibleText(render({ snapshot: snapshot({ state: "starting", frames: [] }) }));
    expect(text).toContain("Connexion…");
    expect(text).toContain("En attente du premier relevé…");
    expect(text).toContain("—");
  });

  it("explains a pause and offers Reprendre", () => {
    setLocale("fr");
    const html = render({ snapshot: snapshot({ state: "paused", reason: "time" }) });
    expect(visibleText(html)).toContain("En pause après 5 minutes.");
    expect(html).toContain("data-resource-resume");
    expect(visibleText(html)).toContain("Reprendre");
  });

  it("states an error in words and an ended card without numbers", () => {
    setLocale("fr");
    const failedHtml = render({ snapshot: snapshot({ state: "error", error: "unreachable", frames: [] }) });
    expect(visibleText(failedHtml)).toContain("L'ordinateur n'a pas répondu.");
    // no empty tiles that would read as "waiting"
    expect(failedHtml).not.toContain("data-resource-tile");
    expect(failedHtml).toContain('role="alert"');
    const gone = render({ snapshot: null, gone: true });
    expect(visibleText(gone)).toContain("Redemandez au bot");
    expect(gone).not.toContain("data-resource-tile");
    expect(gone).not.toContain("data-resource-resume");
  });

  it("never shows an id: no sampler id, no UUID even when a host name carries one", () => {
    const html = render({ snapshot: snapshot({ host: { hostname: `srv ${UUID}`, os: "Linux" } }) });
    expect(visibleText(html)).not.toContain(UUID);
    expect(html).not.toContain(view.samplerId);
  });

  it("switches to a table of the same numbers", () => {
    setLocale("fr");
    const html = render();
    expect(html).toContain("Valeurs");
    expect(html).not.toContain("data-resource-table");
    const table = render({ initialMode: "table" });
    expect(table).toContain("data-resource-table");
    expect(table).not.toContain("data-resource-tile");
    const text = visibleText(table);
    expect(text).toContain("Moyenne 1 min");
    expect(text).toContain("Lecture disque 2 Mo/s 2 Mo/s 2 Mo/s");
    expect(text).toContain("Graphiques");
  });
});

describe("usage model", () => {
  it("ages frames against the newest and keeps a minute", () => {
    const points = seriesOf(frames(40), (frame) => frame.cpu?.total);
    expect(points[points.length - 1]!.age).toBe(0);
    expect(points[0]!.age).toBe(60);
    expect(latest(points)).not.toBeNull();
    expect(stats(points).max).toBe(60);
    expect(stats([]).now).toBeNull();
  });

  it("picks clean throughput tops and never a noisy idle axis", () => {
    expect(niceRateMax(0)).toBe(100 * 1024);
    expect(niceRateMax(1.5 * 1024 ** 2)).toBe(2 * 1024 ** 2);
    expect(niceRateMax(700 * 1024 ** 2)).toBe(1000 * 1024 ** 2);
  });

  it("zooms a steady percent chart on its own range, never past 0 or 100", () => {
    expect(percentRange([60, 61, 60.5])).toEqual({ low: 50, high: 70 });
    expect(percentRange([2, 3])).toEqual({ low: 0, high: 20 });
    expect(percentRange([97, 99])).toEqual({ low: 80, high: 100 });
    expect(percentRange([10, 90])).toEqual({ low: 0, high: 100 });
    expect(percentRange([])).toEqual({ low: 0, high: 100 });
  });

  it("reads fullness with thresholds", () => {
    expect(fullness(50, 100)).toBe("ok");
    expect(fullness(86, 100)).toBe("high");
    expect(fullness(96, 100)).toBe("critical");
    expect(fullness(1, 0)).toBe("ok");
  });

  it("applies stream events", () => {
    const start = applyEvent(null, { kind: "snapshot", snapshot: snapshot({ state: "starting", frames: [] }) })!;
    const framed = applyEvent(start, { kind: "frame", frame: frames(1)[0]!, host: { uptimeSec: 5 } })!;
    expect(framed.state).toBe("live");
    expect(framed.frames).toHaveLength(1);
    expect(framed.host.uptimeSec).toBe(5);
    const paused = applyEvent(framed, { kind: "state", state: "paused", reason: "idle" })!;
    expect(paused).toMatchObject({ state: "paused", reason: "idle" });
    expect(paused.endsAt).toBeUndefined();
    expect(applyEvent(null, { kind: "frame", frame: frames(1)[0]! })).toBeNull();
  });
});
