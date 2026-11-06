// @ts-nocheck
/** confidentialPerspicaxRefusal (#1388). Pure move from server/index.ts. */
import { CONFIDENTIAL_CARD_MAX_CHARS, PERSPICAX_MEMORY_REFUSED, memoryWriteDigest, outboundCallDigest, perspicaxConfidentialVerdict, perspicaxMemoryVerdict, pinPersonalScope, MEMORY_BOUND_FIELDS } from "../threads/confidential-threads.ts";
import { cwActionLanguage } from "../widgets/cw-widget-actions.ts";
export type Host = Record<string, any>;

export function createConfidentialPerspicaxRefusal(getHost: () => Host): any {
function confidentialPerspicaxRefusal(capability: { threadId: string; botId: string }, tool: string, args: Record<string, unknown> | undefined,   judge: (tool: string, args: Record<string, unknown> | undefined) => ReturnType<typeof perspicaxConfidentialVerdict> = perspicaxConfidentialVerdict,   gate = "perspicax") {
  const host = getHost();
  const { randomUUID } = host;

  if (!host.store.isConfidentialThread(capability.threadId)) return null;
  const verdict = judge(tool, args);
  if (verdict === "pass") return null;
  if (verdict === "refuse") return PERSPICAX_MEMORY_REFUSED;
  const bare = tool.includes("__") ? tool.slice(tool.lastIndexOf("__") + 2) : tool;
  // memory_write to "me" (scope written in); the file-style memory tool is
  // already confined to /memories/me/ by its verdict, its call shown as is
  const memory = judge === perspicaxConfidentialVerdict && (bare === "memory_write" || bare === "memory_save") && perspicaxMemoryVerdict(tool, args) === "confirm";
  if (memory) {
    if (!args) return PERSPICAX_MEMORY_REFUSED;
    // the write goes to "me", said explicitly, whatever Perspicax's default is
    pinPersonalScope(args);
    if (args.scope !== "me") return PERSPICAX_MEMORY_REFUSED;
  }
  // the pass is for this server, this tool and these arguments only
  const digest = memory ? memoryWriteDigest(args, gate) : outboundCallDigest(tool, args, gate);
  if (host.confidentialMemoryPasses.take(capability.threadId, digest)) return null;
  const bot = host.store.bot(capability.botId);
  if (!bot) return PERSPICAX_MEMORY_REFUSED;
  // #2091 (decided 2026-11-05): Always allow keeps this kind of confidential
  // write (the person's memory, or this tool leaving the thread) for this
  // bot; kept, the call passes and the journal names the rule
  const confidentialRule = {
    tool: "sagax:confidential_memory",
    scope: (memory ? { kind: "memory" } : { kind: "outbound", tool }) as Record<string, string>,
    description: memory ? "Save notes from this confidential thread to your personal memory" : `Let "${tool}" leave this confidential thread`
  };
  const keptConfidential = host.keptCardRule(bot, capability.threadId, confidentialRule);
  if (keptConfidential) {
    host.appendDecision(host.DATA_DIR, { threadId: capability.threadId, requestId: `confidential-rule-${randomUUID()}`, botId: bot.id, botName: bot.name, tool, summary: memory ? "Personal memory write from a confidential thread" : `${tool} leaves a confidential thread`, decision: "auto-approved", source: "owner-rule", rule: keptConfidential.id });
    return null;
  }
  const requestId = randomUUID();
  if (host.pendingConfidentialMemory.size >= 256) host.pendingConfidentialMemory.delete(host.pendingConfidentialMemory.keys().next().value!);
  host.pendingConfidentialMemory.set(requestId, { threadId: capability.threadId, botId: bot.id, digest });
  const french = cwActionLanguage(host.cfg.language) === "fr";
  // The card shows exactly what would leave, whole: every bound field of a
  // memory write, every argument of a call. Too long to show whole: refused.
  const shown = memory
    ? `${french ? "Mémoire personnelle" : "Personal memory"}\n${JSON.stringify(Object.fromEntries(MEMORY_BOUND_FIELDS.filter((key) => args?.[key] !== undefined).map((key) => [key, args![key]])), null, 2)}`
    : `${gate === "perspicax" ? "" : `${gate} · `}${tool}\n${JSON.stringify(args ?? {}, null, 2)}`;
  if (shown.length > CONFIDENTIAL_CARD_MAX_CHARS) {
    host.pendingConfidentialMemory.delete(requestId);
    return "This is a confidential thread: this call is too long to show the person whole on a card, so it was not sent. Make it smaller, or keep the content in this conversation.";
  }
  // a confidential thread's memory write: isolation, the one hold Full
  // keeps (full-access-gate.ts); full-access: isolation
  host.store.appendMessage(capability.threadId, {
    role: "bot",
    kind: "options",
    from: { botId: bot.id, name: bot.name, color: bot.color },
    card: {
      title: memory
        ? (french ? "Enregistrer dans ta mémoire personnelle?" : "Save to your personal memory?")
        : (french ? "Laisser sortir ceci d'un fil confidentiel?" : "Let this leave a confidential thread?"),
      subtitle: shown,
      options: ["Allow", "Deny"],
      requestId,
      tool,
      confidentialMemoryRequest: { id: requestId },
      ownerRule: confidentialRule
    }
  });
  return memory
    ? "This is a confidential thread: a note to the person's own memory waits for their Allow on the card now shown in this conversation. Nothing was saved. Do not retry now; if they allow it you will be asked to save it again with exactly the same arguments."
    : "This is a confidential thread: this call would send its content outside it, so it waits for the person's Allow on the card now shown in this conversation. Nothing was sent. Do not retry now; if they allow it you will be asked to make exactly the same call again.";

}
  return confidentialPerspicaxRefusal;
}
