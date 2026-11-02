// A change asked from a widget (a ticket's status, a note). The widget never
// writes to ConnectWise itself: the server shows an approval card, and once
// the person allows it, asks the bot to make that one change with its own
// ConnectWise tool. The bot's write is then let through once, for that
// record only (server/cw-widget-actions.ts).

import { clip, clipBlock, isRecord } from "./read.ts";

export const CW_STATUS_MAX = 80;
export const CW_ACTION_NOTE_MAX = 4000;

export const CW_BILLABLE = ["Billable", "DoNotBill", "NoCharge"] as const;
export type CwBillable = (typeof CW_BILLABLE)[number];

export type CwAction =
  | { kind: "ticket.status"; ticketId: number; status: string; from?: string }
  | { kind: "ticket.note"; ticketId: number; text: string; internal: boolean }
  | { kind: "time.billable"; entryId: number; billable: CwBillable; from?: string }
  | { kind: "schedule.done"; entryId: number; done: boolean }
  | { kind: "company.note"; companyId: number; text: string };

export type CwActionKind = CwAction["kind"];

function billableOf(value: unknown): CwBillable | undefined {
  return CW_BILLABLE.find((option) => option === value);
}

function positiveId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 1e12 ? value : undefined;
}

function oneLine(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const line = clip(value, max + 1);
  return line && line.length <= max ? line : undefined;
}

/** A well-formed action, or null. */
export function parseCwAction(value: unknown): CwAction | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case "ticket.status": {
      const ticketId = positiveId(value.ticketId);
      const status = oneLine(value.status, CW_STATUS_MAX);
      if (!ticketId || !status) return null;
      const from = oneLine(value.from, CW_STATUS_MAX);
      if (from === status) return null;
      return { kind: "ticket.status", ticketId, status, ...(from ? { from } : {}) };
    }
    case "ticket.note": {
      const ticketId = positiveId(value.ticketId);
      const text = typeof value.text === "string" ? clipBlock(value.text, CW_ACTION_NOTE_MAX + 1) : "";
      if (!ticketId || !text || text.length > CW_ACTION_NOTE_MAX) return null;
      return { kind: "ticket.note", ticketId, text, internal: value.internal === true };
    }
    case "time.billable": {
      const entryId = positiveId(value.entryId);
      const billable = billableOf(value.billable);
      if (!entryId || !billable) return null;
      const from = billableOf(value.from);
      if (from === billable) return null;
      return { kind: "time.billable", entryId, billable, ...(from ? { from } : {}) };
    }
    case "schedule.done": {
      const entryId = positiveId(value.entryId);
      if (!entryId || typeof value.done !== "boolean") return null;
      return { kind: "schedule.done", entryId, done: value.done };
    }
    case "company.note": {
      const companyId = positiveId(value.companyId);
      const text = typeof value.text === "string" ? clipBlock(value.text, CW_ACTION_NOTE_MAX + 1) : "";
      if (!companyId || !text || text.length > CW_ACTION_NOTE_MAX) return null;
      return { kind: "company.note", companyId, text };
    }
    default:
      return null;
  }
}

/** The `cw_psa_write` arguments that make the change. */
export function cwActionWrite(action: CwAction): { resource: string; operation: string; body: unknown } {
  switch (action.kind) {
    case "ticket.status":
      return {
        resource: `service/tickets/${action.ticketId}`,
        operation: "patch",
        body: [{ op: "replace", path: "status", value: { name: action.status } }],
      };
    case "ticket.note":
      return {
        resource: `service/tickets/${action.ticketId}/notes`,
        operation: "create",
        body: {
          text: action.text,
          detailDescriptionFlag: !action.internal,
          internalAnalysisFlag: action.internal,
        },
      };
    case "time.billable":
      return {
        resource: `time/entries/${action.entryId}`,
        operation: "patch",
        body: [{ op: "replace", path: "billableOption", value: action.billable }],
      };
    case "schedule.done":
      return {
        resource: `schedule/entries/${action.entryId}`,
        operation: "patch",
        body: [{ op: "replace", path: "doneFlag", value: action.done }],
      };
    case "company.note":
      return {
        resource: `company/companies/${action.companyId}/notes`,
        operation: "create",
        body: { text: action.text },
      };
  }
}

/** The record ids the bot's write must name to be the change allowed. */
export function cwActionAnchors(action: CwAction): number[] {
  switch (action.kind) {
    case "ticket.status":
    case "ticket.note":
      return [action.ticketId];
    case "time.billable":
    case "schedule.done":
      return [action.entryId];
    case "company.note":
      return [action.companyId];
  }
}

function namesRecord(input: string, id: number): boolean {
  return new RegExp(`(?<![\\d.])${id}(?![\\d.])`).test(input);
}

/** The bot's ConnectWise write is the change that was allowed: it names the
 * same record and the same kind of field. A ticket note is not a company
 * note, even when the numbers match. */
export function cwActionMatchesWrite(action: CwAction, input: string): boolean {
  if (!input || !cwActionAnchors(action).every((id) => namesRecord(input, id))) return false;
  switch (action.kind) {
    case "ticket.status":
      return /service\/tickets\/\d+/.test(input) && /status/i.test(input) && !/\/notes/.test(input);
    case "ticket.note":
      return /service\/tickets\/\d+\/notes/.test(input);
    case "time.billable":
      return /time\/entries\/\d+/.test(input) && /billable/i.test(input);
    case "schedule.done":
      return /schedule\/entries\/\d+/.test(input) && /done/i.test(input);
    case "company.note":
      return /company\/companies\/\d+\/notes/.test(input);
  }
}

export type CwLanguage = "fr" | "en";

function quoted(text: string, max = 80): string {
  return `« ${clip(text, max)} »`;
}

/** One line for the approval card and the chat. */
export function cwActionSummary(action: CwAction, language: CwLanguage): string {
  const fr = language === "fr";
  switch (action.kind) {
    case "ticket.status":
      return fr
        ? `Changer le statut du billet #${action.ticketId}${action.from ? ` de ${quoted(action.from)}` : ""} à ${quoted(action.status)}`
        : `Change ticket #${action.ticketId} status${action.from ? ` from "${clip(action.from, 80)}"` : ""} to "${clip(action.status, 80)}"`;
    case "ticket.note":
      return fr
        ? `Ajouter une note ${action.internal ? "interne" : "à la discussion"} au billet #${action.ticketId}`
        : `Add ${action.internal ? "an internal" : "a discussion"} note to ticket #${action.ticketId}`;
    case "time.billable": {
      const label = action.billable === "DoNotBill" ? (fr ? "non facturable" : "do not bill")
        : action.billable === "NoCharge" ? (fr ? "sans frais" : "no charge")
          : (fr ? "facturable" : "billable");
      return fr
        ? `Marquer l'entrée de temps #${action.entryId} comme ${label}`
        : `Mark time entry #${action.entryId} as ${label}`;
    }
    case "schedule.done":
      return fr
        ? action.done
          ? `Marquer le rendez-vous #${action.entryId} comme fait`
          : `Rouvrir le rendez-vous #${action.entryId}`
        : action.done
          ? `Mark schedule entry #${action.entryId} done`
          : `Reopen schedule entry #${action.entryId}`;
    case "company.note":
      return fr
        ? `Ajouter une note à la compagnie #${action.companyId}`
        : `Add a note to company #${action.companyId}`;
  }
}

/** The message the person sends the bot once they allow the change. It
 * carries the exact write, so the bot makes that change and nothing else. */
export function cwActionInstruction(action: CwAction, language: CwLanguage): string {
  const summary = cwActionSummary(action, language);
  const write = JSON.stringify(cwActionWrite(action));
  const noteText = action.kind === "ticket.note" || action.kind === "company.note" ? action.text : "";
  const detail = noteText
    ? language === "fr" ? `\n\nNote :\n${noteText}` : `\n\nNote:\n${noteText}`
    : "";
  return language === "fr"
    ? `${summary}. Approuvé dans le widget ConnectWise.${detail}\n\nFais ce changement maintenant avec ton outil ConnectWise (cw_psa_write), une seule fois, puis confirme en une phrase. Arguments : ${write}`
    : `${summary}. Approved in the ConnectWise widget.${detail}\n\nMake this change now with your ConnectWise tool (cw_psa_write), once, then confirm in one sentence. Arguments: ${write}`;
}
