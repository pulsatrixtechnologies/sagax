/** Isolated gallery for headless screenshots of the resource usage card,
 * with mocked frames (no server, no stream): a Windows session through
 * Tailcat, a Linux server with 16 cores, the narrow width, and the starting,
 * paused, error and ended states. Not shipped in the app.
 * ?skin=<id>&lang=<code>&only=<sample> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import type { ResourceFrame, ResourceUsageSnapshot, ResourceUsageView } from "../../shared/resource-usage";
import { ResourceUsageBody } from "../components/resource-usage/ResourceUsageCard";
import { readColorScheme } from "../lib/color-scheme";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");
const only = params.get("only");

const NOW = 1_800_000_000_000;
const GB = 1024 ** 3;
const MB = 1024 ** 2;

/** Smooth, repeatable noise so every capture is the same picture. */
function wave(index: number, seed: number, low: number, high: number): number {
  const value = 0.5 + 0.28 * Math.sin(index / 3.1 + seed) + 0.17 * Math.sin(index / 1.3 + seed * 2.7) + 0.05 * Math.sin(index * 1.9 + seed * 5);
  return low + Math.max(0, Math.min(1, value)) * (high - low);
}

function makeFrames(options: { cores: number; memTotal: number; memUsed: number; swap?: [number, number]; disk: number; net: number; volumes: ResourceFrame["volumes"]; cpuLow: number; cpuHigh: number }): ResourceFrame[] {
  return Array.from({ length: 31 }, (_unused, index) => {
    const total = wave(index, 1, options.cpuLow, options.cpuHigh);
    const cores = Array.from({ length: options.cores }, (_core, core) => Math.min(100, wave(index, core * 1.7 + 0.3, total * 0.4, total * 1.6)));
    return {
      t: NOW - (30 - index) * 2000,
      cpu: { total, cores },
      mem: {
        used: options.memUsed + wave(index, 4, -0.15, 0.15) * GB,
        total: options.memTotal,
        ...(options.swap ? { swapUsed: options.swap[0], swapTotal: options.swap[1] } : {}),
      },
      disk: { readBps: wave(index, 2, 0, options.disk), writeBps: wave(index, 3.3, 0, options.disk * 0.45) },
      net: { rxBps: wave(index, 5, options.net * 0.1, options.net), txBps: wave(index, 6.2, 0, options.net * 0.25) },
      volumes: options.volumes,
    };
  });
}

const windowsFrames = makeFrames({
  cores: 8, memTotal: 16 * GB, memUsed: 9.6 * GB, swap: [1.1 * GB, 2.4 * GB], disk: 18 * MB, net: 2.4 * MB, cpuLow: 18, cpuHigh: 64,
  volumes: [{ name: "C:", used: 401 * GB, total: 476 * GB }, { name: "D:", used: 312 * GB, total: 931 * GB }],
});
const linuxFrames = makeFrames({
  cores: 16, memTotal: 64 * GB, memUsed: 41 * GB, swap: [0.2 * GB, 8 * GB], disk: 120 * MB, net: 38 * MB, cpuLow: 6, cpuHigh: 42,
  volumes: [{ name: "/", used: 61 * GB, total: 98 * GB }, { name: "/mnt/cache", used: 905 * GB, total: 931 * GB }, { name: "/srv/data", used: 7.1 * 1024 * GB, total: 16 * 1024 * GB }],
});

const tailcatView: ResourceUsageView = { samplerId: "ru_0123456789abcdef01", target: "remote-session", label: "Session à distance", hostLabel: "BQDHS7" };
const serverView: ResourceUsageView = { samplerId: "ru_abcdef0123456789ab", target: "host", label: "Serveur unRAID", hostLabel: "fs01" };
const mineView: ResourceUsageView = { samplerId: "ru_00112233445566778a", target: "this-computer", label: "Ce poste", hostLabel: "MacBook-Pro" };

const windowsHost = { hostname: "POSTE-01", os: "Microsoft Windows 11 Professionnel", uptimeSec: 3 * 86400 + 4 * 3600 + 620, cores: 8 };
const linuxHost = { hostname: "fs01", os: "Unraid OS 7.1", uptimeSec: 41 * 86400 + 7 * 3600, cores: 16 };

const live = (frames: ResourceFrame[], host: ResourceUsageSnapshot["host"], id: string): ResourceUsageSnapshot => ({ id, state: "live", host, frames, endsAt: NOW + 4 * 60_000 + 12_000 });

const samples: Array<{ id: string; width: number; view: ResourceUsageView; snapshot: ResourceUsageSnapshot | null; gone?: boolean; table?: boolean }> = [
  { id: "tailcat", width: 600, view: tailcatView, snapshot: live(windowsFrames, windowsHost, tailcatView.samplerId) },
  { id: "server", width: 600, view: serverView, snapshot: live(linuxFrames, linuxHost, serverView.samplerId) },
  { id: "table", width: 600, view: serverView, snapshot: live(linuxFrames, linuxHost, serverView.samplerId), table: true },
  { id: "narrow", width: 360, view: tailcatView, snapshot: live(windowsFrames, windowsHost, tailcatView.samplerId) },
  { id: "starting", width: 600, view: mineView, snapshot: { id: mineView.samplerId, state: "starting", host: {}, frames: [] } },
  { id: "paused", width: 600, view: serverView, snapshot: { ...live(linuxFrames, linuxHost, serverView.samplerId), state: "paused", reason: "time" } },
  { id: "error", width: 600, view: tailcatView, snapshot: { id: tailcatView.samplerId, state: "error", error: "unreachable", host: windowsHost, frames: [] } },
  { id: "gone", width: 600, view: mineView, snapshot: null, gone: true },
];

function Gallery() {
  const scheme = readColorScheme();
  return (
    <div className="flex flex-col items-start gap-8 bg-app p-6 text-ink">
      {samples.filter((sample) => !only || sample.id === only).map((sample) => (
        <div key={sample.id} data-gallery-sample={sample.id} style={{ width: sample.width }}>
          <ResourceUsageBody view={sample.view} snapshot={sample.snapshot} gone={sample.gone ?? false} scheme={scheme} now={NOW} initialMode={sample.table ? "table" : "charts"} />
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);
