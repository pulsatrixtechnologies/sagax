// #3697: what each approval level answers today for a read of a private key
// and of a project .env, through a file tool and through a shell command,
// on the owner route (the request.opened pipeline of
// server/runtime-events/request-opened.ts, in its order: autoVerdict for the
// level, ownerDecision with the owner mode the level reads as, then
// ownerVerdictOver), as owner-approval-levels.test.ts reads it.
//
// The reference is Full access: the level where the sensitive-path hold of
// full-access-gate.ts is meant to apply. Auto must give exactly Full
// access's answer for these calls, and for ordinary commands that only
// look like them. This file observes; it pins today's answers so a change
// to one level shows here.
import { describe, expect, it } from "vitest";

import type { ApprovalMode } from "../../shared/approval-mode.ts";
import { autoVerdict } from "./auto-approve.ts";
import { ownerDecision, ownerVerdictOver } from "./owner-approval.ts";
import { ownerModeForTurn } from "./owner-autonomy.ts";

const OWNER = "pr_owner";
const LEVELS = ["ask", "edits", "auto", "full"] as const satisfies readonly ApprovalMode[];

interface Call { tool: string; input: string }

const read = (path: string): Call => ({ tool: "Read", input: JSON.stringify({ file_path: path }) });
const shell = (command: string): Call => ({ tool: "Bash", input: JSON.stringify({ command }) });

/** "card (<reason>)" or "no card (<source>)", as the pipeline answers. */
function decide(level: ApprovalMode, call: Call): string {
  const base = autoVerdict(level, call.tool, {});
  const owner = ownerDecision({
    mode: ownerModeForTurn({ approvalMode: level, lineage: "owner", autoAllowed: true, bypassAllowed: true }),
    rules: [],
    call: { ownerId: OWNER, botId: "bot-a", tool: call.tool, input: call.input },
  });
  if (owner.kind === "deny") return "refused";
  const verdict = ownerVerdictOver(base, owner, call.tool);
  if (verdict?.approve) return `no card (${verdict.source})`;
  return `card (${owner.kind === "card" ? owner.reason : verdict?.source ?? base.source})`;
}

const KEY_READ = read("/home/owner/.ssh/id_ed25519");
const KEY_SHELL = shell("cat ~/.ssh/id_ed25519");
const ENV_READ = read("/home/owner/project/.env");
const ENV_SHELL = shell("cat .env");

describe("#3697 today's answers by level for a sensitive read", () => {
  // Observed on main, 2026-11-11. Full access answers all four with no
  // card (owner-bypass): its sensitive-path hold is not applied to the
  // owner route, for a file tool or a shell command. Auto answers them the
  // same way (owner-auto). Ask and Edits keep a card.
  const observed: Record<string, Record<(typeof LEVELS)[number], string>> = {
    "Read ~/.ssh/id_ed25519": { ask: "card (no-rule)", edits: "card (no-rule)", auto: "no card (owner-auto)", full: "no card (owner-bypass)" },
    "cat ~/.ssh/id_ed25519": { ask: "card (no-rule)", edits: "card (no-rule)", auto: "no card (owner-auto)", full: "no card (owner-bypass)" },
    "Read project .env": { ask: "card (no-rule)", edits: "card (no-rule)", auto: "no card (owner-auto)", full: "no card (owner-bypass)" },
    "cat .env": { ask: "card (no-rule)", edits: "card (no-rule)", auto: "no card (owner-auto)", full: "no card (owner-bypass)" },
  };
  const calls: Record<string, Call> = {
    "Read ~/.ssh/id_ed25519": KEY_READ,
    "cat ~/.ssh/id_ed25519": KEY_SHELL,
    "Read project .env": ENV_READ,
    "cat .env": ENV_SHELL,
  };
  for (const [name, row] of Object.entries(observed)) {
    for (const level of LEVELS) {
      it(`${name} at ${level}: ${row[level]}`, () => {
        expect(decide(level, calls[name]!)).toBe(row[level]);
      });
    }
  }
});

describe("#3697 Auto gives Full access's answer", () => {
  const cards = (answer: string) => answer.startsWith("card");
  const cases: Array<[string, Call]> = [
    ["Read ~/.ssh/id_ed25519", KEY_READ],
    ["cat ~/.ssh/id_ed25519", KEY_SHELL],
    ["Read project .env", ENV_READ],
    ["cat .env", ENV_SHELL],
    ["cat .npmrc", shell("cat .npmrc")],
    ["cat ~/.gitconfig", shell("cat ~/.gitconfig")],
    ["ls ~/.ssh", shell("ls ~/.ssh")],
    ["touch .env", shell("touch .env")],
    ["echo .env >> .gitignore", shell("echo .env >> .gitignore")],
    ["curl https://example.com/token", shell("curl https://example.com/token")],
    ["gh api repos/o/r/contents/.env", shell("gh api repos/o/r/contents/.env")],
    ["docker compose --env-file .env up", shell("docker compose --env-file .env up")],
    ["openssl x509 -in cert.pem", shell("openssl x509 -in cert.pem")],
    ["Edit secrets.ts", { tool: "Edit", input: JSON.stringify({ file_path: "/home/owner/project/secrets.ts", old_string: "a", new_string: "b" }) }],
  ];
  for (const [name, call] of cases) {
    it(`${name}: a card at Auto exactly when Full access shows one`, () => {
      expect(cards(decide("auto", call))).toBe(cards(decide("full", call)));
    });
  }
});
