import { describe, expect, it } from "vitest";

import {
  askedForResources,
  formatBytes,
  formatPercent,
  formatRate,
  formatUptime,
  RESOURCE_WINDOW_FRAMES,
  windowFrames,
  type ResourceFrame,
} from "./resource-usage.ts";

describe("askedForResources", () => {
  it("matches the person's ways of asking for a usage view", () => {
    for (const text of [
      "montre-moi la consommation de mon poste",
      "c'est quoi l'utilisation CPU de srv01?",
      "combien de RAM sur le poste en session Tailcat",
      "show me resource usage on the server",
      "graphique du CPU du serveur",
      "c'est quoi l'usage du réseau sur fs01",
      "how much memory is the server using",
    ]) expect(askedForResources(text), text).toBe(true);
  });

  it("stays quiet on unrelated requests", () => {
    for (const text of [
      "écris un courriel à Marc", "ferme le billet 1234", "", undefined,
      // a resource word alone is not a request to see usage
      "la charge de travail de Marc cette semaine", "load the file again", "le réseau de distribution",
      "network with the client", "memory of our meeting", "storage room booking", "ajoute de la RAM au devis",
    ]) {
      expect(askedForResources(text ?? undefined), String(text)).toBe(false);
    }
  });
});

describe("formatting", () => {
  it("folds bytes into readable units, French and English", () => {
    expect(formatBytes(0, "fr")).toBe("0 o");
    expect(formatBytes(1536, "fr")).toBe("1,5 Ko");
    expect(formatBytes(16 * 1024 ** 3, "fr")).toBe("16 Go");
    expect(formatBytes(3.25 * 1024 ** 4, "en")).toBe("3.3 TB");
    expect(formatBytes(512, "en")).toBe("512 B");
  });

  it("writes rates per second and never a negative or NaN", () => {
    expect(formatRate(2.5 * 1024 * 1024, "fr")).toBe("2,5 Mo/s");
    expect(formatRate(-5, "en")).toBe("0 B/s");
    expect(formatRate(Number.NaN, "en")).toBe("0 B/s");
  });

  it("writes percents with the French space", () => {
    expect(formatPercent(37.4, "fr")).toBe("37 %");
    expect(formatPercent(3.46, "en")).toBe("3.5%");
    expect(formatPercent(120, "en")).toBe("100%");
  });

  it("writes uptime in days, hours and minutes", () => {
    expect(formatUptime(59, "fr")).toBe("< 1 min");
    expect(formatUptime(3 * 86400 + 4 * 3600 + 120, "fr")).toBe("3 j 4 h");
    expect(formatUptime(5 * 3600 + 7 * 60, "en")).toBe("5 h 7 min");
  });
});

describe("windowFrames", () => {
  it("keeps the last minute of frames, oldest first", () => {
    const frames: ResourceFrame[] = Array.from({ length: 50 }, (_unused, index) => ({ t: index * 2000, cpu: null, mem: null, disk: null, net: null }));
    const kept = windowFrames(frames);
    expect(kept).toHaveLength(RESOURCE_WINDOW_FRAMES);
    expect(kept[kept.length - 1]!.t).toBe(49 * 2000);
  });
});
