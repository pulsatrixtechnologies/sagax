// The Messages (iMessage and Apple apps) MCP route of the environments
// handlers, split out of internal-environments-handlers.ts.
import { homedir } from "node:os";
import { join } from "node:path";
import { relayMacAppCall } from "../desktop/desktop-bridge-tools.ts";
import { messagesOnBotMac } from "../../shared/imessage.ts";
import type { MacAppId, MacAppToolResult } from "../../electron/mac-apps.mjs";
import type { InternalRouteContext } from "./internal-route.ts";
import { PASS } from "./table.ts";
import type { InternalEnvironmentsDeps } from "./internal-environments-handlers.ts";

type EnvironmentAnswer = typeof PASS | Promise<void>;

export function routeMessagesMcp(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): EnvironmentAnswer {
  const { path, method } = ctx;
  if (!(method === "POST" && path === "/api/internal/messages/mcp")) return PASS;
  return answerMessagesMcp(deps, ctx);
}

async function answerMessagesMcp(deps: InternalEnvironmentsDeps, ctx: InternalRouteContext): Promise<void> {
  const { res, json, capability, readBody } = ctx;
  deps.requireActive(capability);
  const body = await readBody();
  const sender = deps.bot(capability.botId)!;
  const unasked = ["auto", "full"].includes(deps.sourceApprovalMode(sender.id, capability.threadId));
  const kept = (tool: string) => Boolean(deps.keptCardRule?.(sender, capability.threadId, macAppRule(tool)));
  // Organization server: the turn's person's own Mac runs the Apple apps,
  // through their desktop app. Offline, the tools stay and say so.
  const relayPerson = capability.desktopPrincipalId
    && !messagesOnBotMac({ platform: deps.platform(), identityKind: deps.identityKind() }).ok
    ? capability.desktopPrincipalId : null;
  const relayMacApps = relayPerson ? {
    macApps: {
      enabled: (app: MacAppId) => (deps.desktopBridgeMacAppsOn?.(relayPerson) ?? []).includes(app),
      run: (tool: string, args: Record<string, unknown>) => relayMacAppCall(async (operation) => {
        const detail = `mac_app ${tool}`;
        try {
          const answer = await deps.desktopBridgesRequest(relayPerson, operation, () => deps.isActive(capability), undefined, { botId: capability.botId, threadId: capability.threadId });
          deps.bridgeAuditRecord({ person: relayPerson, botId: capability.botId, threadId: capability.threadId, target: "user-desktop", kind: "tool", detail, ok: (answer as { isError?: boolean } | null)?.isError !== true });
          return answer;
        } catch (error) {
          deps.bridgeAuditRecord({ person: relayPerson, botId: capability.botId, threadId: capability.threadId, target: "user-desktop", kind: "tool", detail, ok: false, error: (error as Error).message });
          throw error;
        }
      }, tool, args) as Promise<MacAppToolResult>,
      unasked,
      kept,
      relay: { person: relayPerson },
    },
  } : null;
  const handled = await deps.handleMessagesMcp(body, {
    host: { platform: deps.platform(), identityKind: deps.identityKind(), bridgeAction: false },
    useMessages: deps.messagesUseMessages(),
    dbDir: messagesOnBotMac({ platform: deps.platform(), identityKind: deps.identityKind() }).ok
      ? join(homedir(), "Library", "Messages")
      : null,
    filesRoots: [deps.workspaceDir(sender.id), join(deps.taskWorkspacesDir(), sender.id, capability.threadId)],
    allowedRecipients: sender.allowedRecipients,
    grantsAllowed: deps.standingGrantsAllowed(),
    stepUp: (args) => deps.autoAnswerStepUp(sender, capability.threadId, {
      tool: "send_message",
      input: JSON.stringify(args),
      summary: "Send a message",
    }).length > 0,
    sender: deps.imessageSender as never,
    botId: sender.id,
    threadId: capability.threadId,
    ...(relayMacApps ?? (deps.macAppEnabled && deps.runMacApp ? {
      macApps: {
        enabled: (app: MacAppId) => deps.macAppEnabled!(app),
        run: (tool: string, args: Record<string, unknown>) => deps.runMacApp!(tool, args),
        unasked,
        // Always allow on the card keeps this rule; kept, the write acts unasked.
        kept,
      },
    } : {})),
    openCard: (pending) => {
      if (pending.macApp) {
        // An Apple app write (Mail, Calendar, Reminders, Notes) in Ask mode;
        // Auto and Full act unasked (macApps.unasked). full-access: send
        const message = deps.appendMessage(capability.threadId, {
          role: "bot",
          kind: "options",
          from: { botId: sender.id, name: sender.name, color: sender.color },
          card: {
            title: "Approval needed",
            subtitle: pending.to,
            options: ["Allow", "Deny"],
            requestId: pending.requestId,
            // full-access: send
            requestType: "permission",
            tool: pending.macApp.tool,
            toolInput: JSON.stringify(pending.macApp.args),
            plain: { title: pending.to, line: pending.macApp.tool, risk: "write" },
            // Always allow keeps this Apple app action for the bot (#2091).
            ownerRule: macAppRule(pending.macApp.tool),
          },
        });
        deps.bindImessageMessage(pending.requestId, message.id);
        return;
      }
      const preview = pending.text.length > 240 ? `${pending.text.slice(0, 240)}...` : pending.text;
      const line = pending.fileName ? `${preview ? `${preview} ` : ""}File: ${pending.fileName}` : preview;
      // an iMessage send's card, below Full only (imessage-cards.ts
      // reads the bot's level through its deps); full-access: send
      const message = deps.appendMessage(capability.threadId, {
        role: "bot",
        kind: "options",
        from: { botId: sender.id, name: sender.name, color: sender.color },
        card: {
          title: "Approval needed",
          subtitle: `Message to ${pending.to}: ${line}`,
          options: ["Allow", "Deny"],
          requestId: pending.requestId,
          // full-access: send
          requestType: "permission",
          tool: "send_message",
          toolInput: JSON.stringify({
            to: pending.to,
            text: pending.text,
            service: pending.service,
            ...(pending.fileName ? { file: pending.fileName } : {}),
          }),
          plain: { title: `Message to ${pending.to}`, line, risk: "write" },
        },
      });
      deps.bindImessageMessage(pending.requestId, message.id);
    },
  });
  return json(res, 200, handled);
}

/** What Always allow keeps on an Apple app write card: that action of that
 * app, for this bot (2026-11-06, every card offers Always allow, #2091). */
export function macAppRule(tool: string): { tool: string; scope: Record<string, string>; description: string } {
  return { tool: `mac-app:${tool}`, scope: {}, description: `Use ${tool} on this Mac` };
}
