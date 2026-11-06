// Per-person phone-line SMS contact personas (#2194). Numbers are allowlisted
// on Perspicax; Sagax only stores how the bot should reply and whether to
// summarize to the owner. File: <data>/phone-line-contacts.json (0600).
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import {
  PHONE_CONTACT_LIMITS,
  parsePhoneLineContactAction,
  type PhoneLineContact,
  type PhoneLineContactSettings,
} from "../../shared/phone-line-contacts.ts";
import type { InternalRouteHandler } from "../routes/internal-route.ts";
import { PASS } from "../routes/table.ts";
import { formatPhone } from "../../shared/outbound-call.ts";

const contactSchema = z.object({
  number: z.string().regex(/^\+[1-9]\d{6,14}$/),
  label: z.string().max(PHONE_CONTACT_LIMITS.label).optional(),
  persona: z.string().min(1).max(PHONE_CONTACT_LIMITS.persona),
  language: z.enum(["fr", "en"]),
  hideOwnerName: z.boolean(),
  summarizeToOwner: z.boolean(),
});

const personSchema = z.object({
  noticeUnknown: z.boolean().default(false),
  contacts: z.array(contactSchema).max(PHONE_CONTACT_LIMITS.maxPerPerson),
});

const fileSchema = z.object({
  version: z.literal(1),
  people: z.record(z.string(), personSchema),
});

const personKey = (person: string) => person.trim().toLowerCase();

export class PhoneLineContactsStore {
  private readonly file: string;
  private cache: z.infer<typeof fileSchema> | null = null;

  constructor(dataDir: string) {
    const dir = join(dataDir, "phone-line-contacts");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = join(dir, "contacts.json");
  }

  private load(): z.infer<typeof fileSchema> {
    if (this.cache) return this.cache;
    if (!existsSync(this.file)) {
      this.cache = { version: 1, people: {} };
      return this.cache;
    }
    try {
      this.cache = fileSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
    } catch {
      this.cache = { version: 1, people: {} };
    }
    return this.cache;
  }

  private save(data: z.infer<typeof fileSchema>): void {
    this.cache = data;
    writeFileAtomic(this.file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  }

  settings(person: string): PhoneLineContactSettings {
    const row = this.load().people[personKey(person)];
    return { noticeUnknown: row?.noticeUnknown === true };
  }

  list(person: string): PhoneLineContact[] {
    return [...(this.load().people[personKey(person)]?.contacts ?? [])];
  }

  get(person: string, number: string): PhoneLineContact | null {
    return this.list(person).find((row) => row.number === number) ?? null;
  }

  set(person: string, contact: PhoneLineContact): PhoneLineContact | string {
    const data = this.load();
    const key = personKey(person);
    const row = data.people[key] ?? { noticeUnknown: false, contacts: [] };
    const next = row.contacts.filter((entry) => entry.number !== contact.number);
    if (next.length >= PHONE_CONTACT_LIMITS.maxPerPerson) {
      return `At most ${PHONE_CONTACT_LIMITS.maxPerPerson} phone-line contacts per person.`;
    }
    next.push(contact);
    next.sort((a, b) => a.number.localeCompare(b.number));
    data.people[key] = { ...row, contacts: next };
    this.save(data);
    return contact;
  }

  remove(person: string, number: string): boolean {
    const data = this.load();
    const key = personKey(person);
    const row = data.people[key];
    if (!row) return false;
    const next = row.contacts.filter((entry) => entry.number !== number);
    if (next.length === row.contacts.length) return false;
    if (next.length === 0 && !row.noticeUnknown) delete data.people[key];
    else data.people[key] = { ...row, contacts: next };
    this.save(data);
    return true;
  }

  setNoticeUnknown(person: string, noticeUnknown: boolean): void {
    const data = this.load();
    const key = personKey(person);
    const row = data.people[key] ?? { noticeUnknown: false, contacts: [] };
    if (!noticeUnknown && row.contacts.length === 0) {
      delete data.people[key];
    } else {
      data.people[key] = { ...row, noticeUnknown };
    }
    this.save(data);
  }
}

/** Run one phone_line_contact tool call for the person. A string is the reply. */
export function applyPhoneLineContactTool(store: PhoneLineContactsStore, person: string, args: unknown): string {
  const parsed = parsePhoneLineContactAction(args);
  if (typeof parsed === "string") return parsed;
  if (parsed.action === "list") {
    const contacts = store.list(person);
    const settings = store.settings(person);
    if (!contacts.length) {
      return settings.noticeUnknown
        ? "No phone-line contacts yet. notice_unknown is on (unknown SMS post a notice in your chat)."
        : "No phone-line contacts yet. Numbers must already be on the Perspicax Voice SMS allowlist.";
    }
    const lines = contacts.map((row) => {
      const bits = [
        formatPhone(row.number),
        row.label ? `"${row.label}"` : null,
        row.language,
        row.hideOwnerName ? "hide owner name" : null,
        row.summarizeToOwner ? "summarize to owner" : "no owner summary",
      ].filter(Boolean);
      return `- ${bits.join(", ")}: ${row.persona.slice(0, 120)}${row.persona.length > 120 ? "…" : ""}`;
    });
    return [
      `${contacts.length} phone-line contact${contacts.length === 1 ? "" : "s"}:`,
      ...lines,
      `notice_unknown: ${settings.noticeUnknown ? "on" : "off"}`,
    ].join("\n");
  }
  if (parsed.action === "remove") {
    return store.remove(person, parsed.number)
      ? `Removed ${formatPhone(parsed.number)} from phone-line contacts.`
      : `${formatPhone(parsed.number)} was not a phone-line contact.`;
  }
  if (parsed.action === "notice_unknown") {
    store.setNoticeUnknown(person, parsed.noticeUnknown);
    return parsed.noticeUnknown
      ? "Unknown SMS will post a one-line notice in your unified chat."
      : "Unknown SMS will no longer post a notice in your chat.";
  }
  const saved = store.set(person, parsed.contact);
  if (typeof saved === "string") return saved;
  return `Saved phone-line contact ${formatPhone(saved.number)}${saved.label ? ` (${saved.label})` : ""}. The number must already be on the Perspicax Voice SMS allowlist; this only sets how the bot replies.`;
}

/** POST /api/internal/phone-line-contact behind the turn capability (#2194). */
export function createPhoneLineContactInternalRoute(deps: {
  store: PhoneLineContactsStore;
  principalForThread(threadId: string): string | null;
  ownsThread(botId: string, threadId: string): boolean;
}): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path === "/api/internal/phone-line-contact") {
      if (method !== "POST") return json(res, 405, { error: "POST only" });
      if (!deps.ownsThread(capability.botId, capability.threadId)) {
        return json(res, 403, { error: "source conversation does not belong to sender" });
      }
      const principalId = deps.principalForThread(capability.threadId);
      if (!principalId) return json(res, 200, { text: "This conversation has no person. Nothing was changed.", isError: true });
      const body = await readBody();
      const text = applyPhoneLineContactTool(deps.store, principalId, body);
      const isError = text.startsWith("phone_line_contact needs")
        || text.startsWith("remove needs")
        || text.startsWith("number must")
        || text.startsWith("persona:")
        || text.startsWith("label:")
        || text.startsWith("action:")
        || text.startsWith("At most");
      return json(res, 200, { text, ...(isError ? { isError: true } : {}) });
    }
    return PASS;
  };
}
