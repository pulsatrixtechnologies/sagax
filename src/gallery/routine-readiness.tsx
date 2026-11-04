/** Isolated visual fixture using the routine detail's real check rows. */
import { createRoot } from "react-dom/client";
import { RoutineReadinessList } from "../components/routines/RoutineReadiness";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { RoutineReadinessCheck } from "../../shared/routine-readiness";
import "../styles.css";
const params = new URLSearchParams(location.search);
const skin = params.get("skin") as SkinId;
applySkin((SKIN_IDS as readonly string[]).includes(skin) ? skin : readSkin());
await loadLocale(params.get("lang") ?? "en");
const checks: RoutineReadinessCheck[] = [
  { kind: "engine", ok: false, code: "engine_credits", params: { engine: "Grok", at: "2026-11-04T14:30:00.000Z" }, line: "Credit refused at 14:30 UTC." },
  { kind: "engine", ok: false, code: "engine_limit", params: { engine: "Claude", until: "2026-11-05T07:15:00.000Z" }, line: "Limit resets at 07:15 UTC." },
  { kind: "skills", ok: false, code: "skill_missing", params: { skill: "using-px-flow" }, line: "Skill missing." },
  { kind: "mcp", ok: false, code: "mcp_missing", params: { server: "outlook" }, line: "MCP server missing." },
  { kind: "perspicax", ok: true, code: "ready", line: "Profile ready." },
  { kind: "computer", ok: true, code: "ready", line: "Computer ready." },
  { kind: "computer", ok: false, code: "probe_error", params: { kind: "computer" }, line: "The computer check could not finish.", detail: "Readiness probe timed out." },
];
createRoot(document.getElementById("root")!).render(<main className="min-h-screen bg-panel p-4 text-ink"><div style={{ maxWidth: Number(params.get("width") ?? 700) }}><RoutineReadinessList checks={checks} checkedAt={Date.UTC(2026, 10, 4, 14, 30)} /></div></main>);
