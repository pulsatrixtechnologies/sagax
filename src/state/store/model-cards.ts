// Card payload types of the client store (split out of model.ts).

import type { CardAnswerer } from "../../../shared/wire";
import type { QuestionRequestCardData } from "../../../shared/ask-question";
import type { ProfileRequestCardData } from "../../../shared/profile-request";
import type { ModelRequestCardData } from "../../../shared/model-request";
import type { RuleRequestCardData } from "../../../shared/rule-request";
import type { RoutineRequestCardData } from "../../../shared/routine-request";
import type { SkillRequestCardData } from "../../../shared/skill-request";

export interface OptionCardData {
  approvalOrigin?: import("../../../shared/wire").OptionCardData["approvalOrigin"];
  approvalDestination?: import("../../../shared/wire").OptionCardData["approvalDestination"];
  title: string;
  subtitle: string;
  options: string[];
  /** 2026-10-30: a proactive proposal; answered through its own route
   * (shared/proactive-proposal.ts), options[0] accepts. */
  proactiveProposal?: { id: string };
  /** #3431: a choice card (propose_proactive), drawn by ProactiveChoiceCard
   * (#3457): the domain, and each watch for the folded details. */
  proactiveChoice?: import("../../../shared/wire").OptionCardData["proactiveChoice"];
  /** #2694: the person's feedback on this proactive card. */
  feedback?: "up" | "down" | "less" | "never";
  /** 2026-11-05: an "Agit comme" card (shared/wire.ts RoleTransitionCard). */
  roleTransition?: import("../../../shared/wire").RoleTransitionCard;
  /** Organization server: only an organization admin can answer this card
   * (a server command asked by a member's bot). */
  adminApproval?: boolean;
  /** Who can answer an adminApproval card: the organization admins' names. */
  adminNames?: string[];
  /** Distinguishes a provider question from an approval after its live run ends. */
  requestType?: "permission" | "question";
  /** what each option means, keyed by its label — a question that came with
   * explanations (AskUserQuestion) shows them under the buttons. Kept beside
   * `options` rather than inside it so every existing reader of the plain
   * label list — the phone, call-mode narration, the sidebar preview — keeps
   * working untouched. */
  optionHints?: Record<string, string>;
  /** the question takes more than one option; `answered` is then the chosen
   * labels joined with ", ", which is the format the asking tool expects */
  multiSelect?: boolean;
  answered?: string;
  /** The words an answered question card was answered with — `answered`
   * only holds the behavior once the server settles a live ask. */
  answeredText?: string;
  /** Who settled the card; `via: "call"` when it was decided by voice on a Live call. */
  answeredBy?: CardAnswerer;
  dismissed?: boolean;
  /** #3471: skipped by the person without an answer (`answered` reads "skipped"). */
  skipped?: boolean;
  /** Present when this card is a live provider ask (approval/question). */
  requestId?: string;
  /** permission asks: the tool being requested (drives the approval box) */
  tool?: string;
  /** why auto mode stopped to ask anyway */
  held?: string;
  /** Terminal: this proposal went stale while open (revision mismatch or
   * a superseding request). Nothing can answer it; a fresh proposal is
   * needed, and clients must not offer its options. */
  expired?: boolean;
  /** catalog key for `held` when it is a fixed note, so it reads in the
   * viewer's language; absent for free-text errors and older cards */
  heldCode?: string;
  /** the server's plain words for a permission card (shared/approval-describe.ts) */
  plain?: { title: string; line: string; risk?: "read" | "write" | "destructive" | "execute" };
  /** the engine's own `<server>__<tool>` when `tool` is only a kind */
  mcpTool?: string;
  /** declined by the server at this time when nobody answers */
  expiresAt?: number;
  /** the narrow grant "always allow" remembers, e.g. "Bash:git" */
  allowKey?: string;
  /** 2026-10-14 (bot owner permissions): the rule "Always allow" or
   * "Always deny" would save for the bot's owner: the tool, its target
   * read from the arguments, the destructive kind and plain words. */
  ownerRule?: { tool: string; scope: Record<string, string>; destructive?: "delete" | "bulk" | "external-message"; description: string; from?: "admin" | "hold" | "origin" };
  /** 2026-10-26 (#1065): the second "Always allow", the whole folder of the file this card reads (and its subfolders). */
  ownerRuleFolder?: { tool: string; scope: Record<string, string>; destructive?: "delete" | "bulk" | "external-message"; description: string; writes?: boolean; from?: "admin" | "hold" | "origin" };
  /** The person's own "Ask first" rule that kept this card (shared/wire.ts). */
  heldRule?: { description: string };
  /** The owner's rule saved when answering this card. */
  ruleSaved?: { id: string; behavior: "allow" | "ask" | "deny"; description: string };
  /** the Allow rule saved when this card was answered (server/index.ts) */
  alwaysAllowed?: string;
  allowSession?: boolean;
  /** A permission ask's full arguments as redacted JSON, shown only in
   * the card's collapsed technical details. */
  toolInput?: string;
  /** MCP tool annotations, when the provider passes them on. */
  toolHints?: { readOnly?: boolean; destructive?: boolean };
  /** Exact provider command eligible for a durable, folder-scoped allow. */
  commandAllowlist?: { command: string; cwd: string; providerInstanceId: string };
  approvalScope?: "local-computer";
  /** The bot's change applied without a person (a change to itself, or Full
   * access): shown as one line with Undo instead of the approval box. */
  autoApplied?: boolean;
  /** A person undid that change. */
  undone?: boolean;
  /** Persisted proposal used by the server when the user confirms it. */
  routineRequest?: RoutineRequestCardData;
  /** Staged learned-skill change; applied only after the user confirms this card. */
  skillRequest?: SkillRequestCardData;
  /** calls: one per outbound call the card covers, in subtitle order. Absent
   * on cards from older computers. */
  outboundRequest?: { tool: string; app: string | null; calls?: Array<{ app: string | null; label: string }> };
  teamMemoryRequest?: { section: string; entryId: string; kind: string };
  /** Persisted profile proposal used by the server when the user confirms it. */
  profileRequest?: ProfileRequestCardData;
  /** Persisted default-model proposal used by the server when the user confirms it. */
  modelRequest?: ModelRequestCardData;
  /** Persisted approval-rule proposal (propose_rule: add / change / remove). */
  ruleRequest?: RuleRequestCardData;
  teamSetupRequest?: import("../../../shared/team-setup").TeamSetupRequest;
  /** The model's own questions and options (Claude's AskUserQuestion), so
   * the card offers choices instead of an unanswerable Allow/Deny. */
  questionRequest?: QuestionRequestCardData;
  /** #2048: publish-target choice; enables "Always use this choice". */
  pageTargetChoice?: import("../../../shared/page-targets.ts").PageTargetChoiceCardData;
  /** A bot action waiting for this person's Allow. The id matches requestId. */
  botActRequest?: { id: string };
  /** Shell terminal: opened only after the person taps Ouvrir un terminal. */
  terminalRequest?: import("../../../shared/terminal-request").TerminalRequestCardData;
  /** A meeting the bot asks to join as a notetaker (join_meeting). */
  meetingRequest?: import("../../../shared/meeting-request").MeetingRequestCardData;
  /** One-time acceptable-use consent before a bot may place phone calls. */
  phoneCallConsent?: import("../../../shared/phone-call-consent").PhoneCallConsentCardData;
  /** A change asked from a ConnectWise widget (shared/wire.ts). */
  cwActionRequest?: import("../../../shared/wire").OptionCardData["cwActionRequest"];
  /** 2026-10-16: custom rules (shared/custom-rules.ts) and email draft sends. */
  customRule?: import("../../../shared/wire").OptionCardData["customRule"];
  /** The model reviewer is still judging this card (lot A1b). */
  reviewing?: boolean;
  customRuleCandidate?: import("../../../shared/wire").OptionCardData["customRuleCandidate"];
  customRuleSaved?: import("../../../shared/wire").OptionCardData["customRuleSaved"];
  emailSendRequest?: import("../../../shared/wire").OptionCardData["emailSendRequest"];
}

export interface SecretRequestCardData {
  /** Fixed allowlisted credential id; customSecret: a secret the bot names, kept off Settings;
   * vaultLogin: a login request from the credential vault (carries `vault`). */
  target:
    | import("../../../shared/credential-request").CredentialTargetId
    | import("../../../shared/credential-vault").VaultLoginTarget
    | "customSecret";
  vault?: import("../../../shared/credential-vault").VaultRequestCardData;
  label: string;
  description: string;
  placeholder: string;
  helpUrl: string;
  /** A custom secret's use: "ref" for Sagax tools once, "file" for a private workspace file for a day. */
  delivery?: import("../../../shared/credential-request").SecretDelivery;
  /** Why the bot needs a custom secret (shown on the card). */
  reason?: string;
  /** When a custom secret was saved behind this card (ms); never the value. */
  savedAt?: number;
  requestKey: string;
  provided?: boolean;
  dismissed?: boolean;
  /** A newer request for the same credential replaced this card; it no
   * longer offers entry and cannot be provided or dismissed. */
  superseded?: boolean;
  resumed?: boolean;
  error?: string;
  /** Stop ended the turn this card paused. */
  stopped?: boolean;
}
