import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { EXACT_WORDS, JOINED_INITIALS, LOWER_CASE_WORDS, loadAllowlist, printableRuns, scanPackage, scanText, SUBSTRING_WORDS } from "./npm-package-terms.mjs";

// The real words are private (digests only), so the scan is exercised with
// made-up ones added to the same tables.
const digest = (word) => createHash("sha256").update(word).digest("hex").slice(0, 16);
const made = { [digest("acmeco")]: "company", [digest("pat quill")]: "personal", [digest("zz123")]: "personal", [digest("tkt")]: "tracker", [digest("zorbel")]: "bot-name" };
const exact = { [digest("PQ")]: "initials", [digest("Vexa")]: "bot-name" };
const inside = { [digest("acmeco")]: { term: "company", length: 6 } };
const initials = { [digest("pq")]: "initials" };
const tables = [[LOWER_CASE_WORDS, made], [EXACT_WORDS, exact], [SUBSTRING_WORDS, inside], [JOINED_INITIALS, initials]];

const allowlist = loadAllowlist(join(import.meta.dirname, "npm-package-allowlist.json"));
const dirs = [];
beforeAll(() => {
  for (const [table, extra] of tables) Object.assign(table, extra);
});
afterAll(() => {
  for (const [table, extra] of tables) for (const key of Object.keys(extra)) delete table[key];
});
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const blocked = (text, file = "dist-server/index.js") => scanText(text, allowlist, file).filter((hit) => !hit.allowedBy).map((hit) => hit.term);
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), "npm-terms-"));
  dirs.push(dir);
  return dir;
};

describe("npm package term scan", () => {
  it("refuses listed words in any case, word pairs across a hyphen or a line break, exact-case words and tracker ids", () => {
    expect(blocked("// incident on the ACMECO server")).toEqual(["company"]);
    expect(blocked("asked by zz123 and Pat-Quill, then Pat\nQuill")).toEqual(["personal", "personal", "personal"]);
    expect(blocked("// 2026-10-16 (PQ): one rule; Vexa runs")).toEqual(["initials", "bot-name"]);
    expect(blocked("// fixed (TKT-272)")).toEqual(["tracker"]);
    expect(blocked('like Grok Bot, and "Grok\\nBot" in JSON, and Grok\nBot')).toEqual(["grok-bot", "grok-bot", "grok-bot"]);
  });

  it("finds a word joined to others by underscores, as in an MCP server or tool id", () => {
    expect(blocked("// named whole (`mcp__perspicax_acmeco__cw_psa_query`)")).toEqual(["company"]);
    expect(blocked('server: "perspicax_profil_pat_quill_limited"')).toEqual(["personal"]);
    expect(blocked("const id = 'zz123_backup'")).toEqual(["personal"]);
    expect(blocked("ask Vexa_bot")).toEqual(["bot-name"]);
  });

  it("finds a word inside camelCase and next to digits", () => {
    expect(blocked("const PatQuillNotes = 1")).toEqual(["personal"]);
    expect(blocked("isVexaOnline()")).toEqual(["bot-name"]);
    expect(blocked("ZorbelBot and zorbel2")).toEqual(["bot-name", "bot-name"]);
  });

  it("finds the company name inside any longer word, in any case", () => {
    expect(blocked("acmecocloud.example")).toEqual(["company"]);
    expect(blocked("github.com/acmecotechnologies/x")).toEqual(["company"]);
    expect(blocked("host ACMECOP103 rebooted")).toEqual(["company"]);
    expect(blocked("superacmeco")).toEqual(["company"]);
  });

  it("matches case-insensitive words in every case, and full-width letters", () => {
    expect(blocked("zorbel, Zorbel, ZORBEL")).toEqual(["bot-name", "bot-name", "bot-name"]);
    expect(blocked("ＡＣＭＥＣＯ ops")).toEqual(["company"]);
  });

  it("refuses initials joined by an underscore or a hyphen, in any case", () => {
    expect(blocked("mcp__perspicax_flow_pq__write")).toEqual(["initials"]);
    expect(blocked("flow_Pq and pq-notes and PQ_x")).toEqual(["initials", "initials", "initials"]);
  });

  it("refuses lone initials in any case in prose files, but only the exact case in code", () => {
    expect(blocked("asked pq, Pq and P.Q. about it", "dist-server/self-knowledge/knowledge.generated.json")).toEqual(["initials", "initials", "initials"]);
    expect(blocked("see notes (pq)", "README.md")).toEqual(["initials"]);
    expect(blocked("prop(pq),map(pQ),pq:{break pq}", "dist-server/index.js")).toEqual([]);
    expect(blocked("ask PQ", "dist-server/index.js")).toEqual(["initials"]);
  });

  it("leaves initials alone inside a camelCase or letter-digit run (hashes, base64, minified names)", () => {
    expect(blocked('"assets/wand-sparkles-pPQ6Z-Q9.js" xPQy PQ9')).toEqual([]);
  });

  it("refuses a tracker word before digits after a space, an underscore, a hyphen or nothing", () => {
    expect(blocked("see TKT 204, tkt_12, Tkt-3 and TKT204")).toEqual(["tracker", "tracker", "tracker", "tracker"]);
    expect(blocked("the tkt file, tkt - notes, useTktCache")).toEqual([]);
  });

  it("leaves other words alone: another case for exact words, a near miss, a tracker word without a number", () => {
    expect(blocked("acmcorp pq vexa the tkt file zz1234 pat quillon")).toEqual([]);
  });

  it("masks the matched word in what it reports", () => {
    const [hit] = scanText("see zz123 here", allowlist);
    expect(hit.context).toBe("see z**** here");
  });

  it("keeps the allowlisted interop names, and only where the name itself is allowlisted", () => {
    expect(blocked('grokbot://app/v1/bot-template?id=1 · url.protocol === "grokbot:" · grokbot-bundle/v1 · pi-grokbot-import · ~/.opengrokbot')).toEqual([]);
    expect(blocked("grokbot-bundle/v1 then Grok Bot")).toEqual(["grok-bot"]);
  });

  it("allows the importer's own name for the product only in the importer's files and phrases", () => {
    expect(blocked('throw new GrokImportError("That is not a Grok Bot export.")', "dist-server/shared/grok-import.js")).toEqual([]);
    expect(blocked('const agentKey = slug(name, 60) || "grok-bot";', "dist-server/shared/grok-import.js")).toEqual([]);
    expect(blocked('throw new B(`That is not a Grok Bot export.`)', "dist/assets/TemplateTools-abc.js")).toEqual([]);
    expect(blocked('throw new B(`That is not a Grok Bot export.`)', "dist/assets/GrokImportBox-abc.js")).toEqual([]);
    expect(blocked('throw new B(`That is not a Grok Bot export.`)', "dist/assets/people-dm-abc.js")).toEqual([]);
    expect(blocked('"grokImport.title":`Import a Grok Bot`', "dist/assets/i18n-abc.js")).toEqual([]);
    expect(blocked('"onboarding.firstRun.bot.import":`Import an agent (Grok Bot, Claude Code)`', "dist/assets/i18n-abc.js")).toEqual([]);
    expect(blocked('"onboarding.firstRun.bot.import": "Importer un agent (Grok Bot, Claude Code)"', "dist/assets/fr-abc.js")).toEqual([]);
    expect(blocked('"onboarding.firstRun.bot.import":`Import an agent (Grok Bot, Claude Code, Hermes)`', "dist/assets/i18n-abc.js")).toEqual([]);
    expect(blocked('"onboarding.firstRun.bot.import": "Importer un agent (Grok Bot, Claude Code, Hermes)"', "dist/assets/fr-abc.js")).toEqual([]);
    expect(blocked('"agentImport.grok":`Grok Bot`', "dist/assets/i18n-abc.js")).toEqual([]);
    expect(blocked('"newBot.importAgentOption":`Grok Bot or Claude Code…`', "dist-server/index.js")).toEqual([]);
    expect(blocked('"botWizard.other.importAgent":`Importer de Grok Bot ou Claude Code`', "dist/assets/fr-abc.js")).toEqual([]);
    expect(blocked('"newBot.importAgentOption":`Grok Bot, Claude Code or Hermes…`', "dist-server/index.js")).toEqual([]);
    expect(blocked('"botWizard.other.importAgent":`Importer de Grok Bot, Claude Code ou Hermes`', "dist/assets/fr-abc.js")).toEqual([]);
    expect(blocked("import a Grok Bot agent (desktop and iOS)", "dist/assets/index-abc.js")).toEqual([]);
    expect(blocked("importez un agent Grok Bot (bureau et iOS)", "dist/assets/index-abc.js")).toEqual([]);
    expect(blocked("From Grok Bot is the public product", "dist-server/self-knowledge/knowledge.generated.json")).toEqual([]);
    expect(blocked("docs.x.ai/grok-bot/overview", "dist-server/self-knowledge/knowledge.generated.json")).toEqual([]);
    expect(blocked("// as Grok Bot's sidebar does", "dist-server/index.js")).toEqual(["grok-bot"]);
    expect(blocked("import a Grok Bot agent", "dist-server/index.js")).toEqual(["grok-bot"]);
    expect(blocked("From Grok Bot is the public product", "dist-server/index.js")).toEqual(["grok-bot"]);
    expect(blocked('throw new B(`That is not a Grok Bot export.`)', "dist/assets/Sidebar-abc.js")).toEqual(["grok-bot"]);
    expect(blocked('"newBot.importAgentOption":`Grok Bot or Claude Code…`', "dist/assets/Sidebar-abc.js")).toEqual(["grok-bot"]);
    const pair = '"grok", "grok bot"';
    expect(blocked(pair, "dist-server/shared/computer-app.js")).toEqual([]);
    expect(blocked(pair, "dist-server/index.js")).toEqual([]);
    expect(blocked("a grok bot in a comment", "dist-server/shared/computer-app.js")).toEqual(["grok-bot"]);
  });

  it("allows a minified two-letter variable only in the web bundle", () => {
    // Stand-in pair only. The real initials stay in the hashed table, never in this file.
    const code = "function PQ(e,t){return PQ.$type}";
    expect(scanText(code, [], "x.js").map((hit) => hit.term)).toEqual(["initials", "initials"]);
    expect(blocked(code, "dist/assets/chunk-1.js")).toEqual([]);
    expect(blocked(code, "dist-server/index.js")).toEqual(["initials", "initials"]);
    expect(blocked("o=Yc(e,Math.max(0,i-PQ(e)))", "dist/assets/dist-1.js")).toEqual([]);
    expect(blocked("o=Yc(e,Math.max(0,i-PQ(e)))", "dist-server/index.js")).toEqual(["initials"]);
    expect(blocked("(0,$.jsx)(PQ,{name:1})", "dist/assets/chunk-1.js")).toEqual([]);
    expect(blocked("Kc as qt,PQ as r,i_ as rt", "dist/assets/chunk-1.js")).toEqual([]);
    expect(blocked("(0,$.jsx)(PQ,{name:1})", "dist-server/index.js")).toEqual(["initials"]);
    expect(blocked("Kc as qt,PQ as r", "dist-server/index.js")).toEqual(["initials"]);
  });

  it("allows a minified declaration and two names side by side (`:Sc(PQ)`), in the web bundle only", () => {
    expect(blocked("var PQ=220;function Yc(e){}", "dist/assets/chunk-1.js")).toEqual([]);
    expect(blocked("{bots:Yc(Sc,xc({owner:Zc.nullable(),grants:Sc(PQ).max(qC)}))}", "dist/assets/chunk-1.js")).toEqual([]);
    expect(blocked("var PQ=!1;async function YC(){if(PQ||typeof window)", "dist/assets/chunk-1.js")).toEqual([]);
    expect(blocked("var PQ=220;", "dist-server/index.js")).toEqual(["initials"]);
  });

  it("allows a bot-like given name only inside the new-bot dialog's list of given names", () => {
    expect(blocked('["Ann","Vexa","Bea"]', "dist/assets/NewBotDialog-abc.js")).toEqual([]);
    expect(blocked('["Ann","Vexa","Bea"]', "dist-server/index.js")).toEqual(["bot-name"]);
    expect(blocked("// Vexa said so", "dist/assets/NewBotDialog-abc.js")).toEqual(["bot-name"]);
    expect(blocked('["Ann","Vexa","Bea"]', "dist/assets/IdentitySection-abc.js")).toEqual([]);
  });

  it("keeps the real tables covering each kind of word", () => {
    const kinds = new Set([...Object.values(LOWER_CASE_WORDS), ...Object.values(EXACT_WORDS)]);
    for (const kind of ["company", "personal", "initials", "bot-name", "tracker"]) expect(kinds.has(kind)).toBe(true);
    expect(Object.values(SUBSTRING_WORDS).some((entry) => entry.term === "company" && entry.length > 0)).toBe(true);
    expect(Object.values(JOINED_INITIALS)).toContain("initials");
  });

  it("scans every file of a package folder, binaries through their printable runs", () => {
    const dir = folder();
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "a.js"), "// acmeco\n");
    writeFileSync(join(dir, "image.png"), Buffer.concat([Buffer.from([0x89, 0]), Buffer.from(" built by acmeco_tools \0")]));
    writeFileSync(join(dir, "font.woff2"), Buffer.concat([Buffer.from([0, 1, 0]), Buffer.from("zorbel bold regular", "utf16le"), Buffer.from([0, 0])]));
    writeFileSync(join(dir, "noise.wasm"), Buffer.from("\0\u0001xacmecoq1 run\0"));
    writeFileSync(join(dir, "clean.js"), "export {};\n");
    const result = scanPackage(dir, allowlist);
    expect(result.blocked.map((hit) => `${hit.file}:${hit.term}`)).toEqual(["dist/a.js:company", "font.woff2:bot-name", "image.png:company"]);
    writeFileSync(join(dir, "a.webp"), Buffer.concat([Buffer.from([0, 1]), Buffer.from("h@`PQ(OB#^)?"), Buffer.from([0])]));
    writeFileSync(join(dir, "b.png"), Buffer.concat([Buffer.from([0x89, 0]), Buffer.from(" note PQ here today \0")]));
    const again = scanPackage(dir, allowlist);
    expect(again.blocked.map((hit) => `${hit.file}:${hit.term}`)).toEqual(["b.png:initials", "dist/a.js:company", "font.woff2:bot-name", "image.png:company"]);
  });

  it("refuses a file with a NUL byte that is not a known binary type, instead of skipping it", () => {
    const dir = folder();
    writeFileSync(join(dir, "hidden.js"), "// nothing to see\0\n");
    writeFileSync(join(dir, "notes.json"), '{"a":"\0"}');
    const result = scanPackage(dir, allowlist);
    expect(result.blocked.map((hit) => `${hit.file}:${hit.term}`)).toEqual(["hidden.js:nul-byte", "notes.json:nul-byte"]);
  });

  it("reads ASCII and UTF-16LE runs of eight characters or more from a binary", () => {
    const bytes = Buffer.concat([Buffer.from("\0short\0"), Buffer.from("\0long enough run\0"), Buffer.from("wide text", "utf16le")]);
    const runs = printableRuns(bytes).split("\n");
    expect(runs).toContain("long enough run");
    expect(runs.some((run) => run.endsWith("wide text"))).toBe(true);
    expect(runs).not.toContain("short");
  });

  it("needs a reason for every allowlist entry", () => {
    const dir = folder();
    writeFileSync(join(dir, "list.json"), JSON.stringify([{ term: "company", context: "x", reason: " " }]));
    expect(() => loadAllowlist(join(dir, "list.json"))).toThrow("reason");
  });
});
