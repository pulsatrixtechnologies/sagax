// What bots may do with an enrolled unattended host, per person (#2723):
// Always allow, Ask every time or Never allow, the same three choices as the
// person's own devices. "always" is the default and is never stored, so a
// host nobody set keeps today's behaviour. One file per server, written
// atomically; host ids stay opaque. Person isolation: an entry is the
// choice of the person who made it, about their own host.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "../atomic.ts";
import { UNATTENDED_HOST_ID, type UnattendedHostAccess } from "../../shared/remote-unattended-host.ts";

const entrySchema = z.object({
  hostId: z.string().regex(UNATTENDED_HOST_ID),
  principalId: z.string().trim().min(1).max(200),
  access: z.enum(["ask", "never"]),
  setAt: z.number().finite().nonnegative(),
}).strict();
const fileSchema = z.object({ version: z.literal(1), hosts: z.array(entrySchema).max(5_000) }).strict();
type Entry = z.infer<typeof entrySchema>;

const person = (id: string) => id.trim().toLowerCase();

export class RemoteHostAccess {
  private entries: Entry[] = [];
  private readonly file: string;
  private readonly now: () => number;
  constructor(file: string, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    try {
      if (!existsSync(file)) return;
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_000_000) return;
      this.entries = fileSchema.parse(JSON.parse(readFileSync(file, "utf8"))).hosts;
    } catch {
      // A damaged file reads as the default (always) for every host.
      this.entries = [];
    }
  }

  /** The person's choice for one host ("always" when none is stored). */
  get(principalId: string, hostId: string): UnattendedHostAccess {
    const who = person(principalId);
    return this.entries.find((entry) => entry.hostId === hostId && person(entry.principalId) === who)?.access ?? "always";
  }

  /** The person's stored choices, by host id. */
  forPrincipal(principalId: string): Map<string, UnattendedHostAccess> {
    const who = person(principalId);
    return new Map(this.entries.filter((entry) => person(entry.principalId) === who).map((entry) => [entry.hostId, entry.access]));
  }

  set(principalId: string, hostId: string, access: UnattendedHostAccess): UnattendedHostAccess {
    const who = person(principalId);
    const rest = this.entries.filter((entry) => !(entry.hostId === hostId && person(entry.principalId) === who));
    this.entries = access === "always" ? rest : [...rest, entrySchema.parse({ hostId, principalId: who, access, setAt: this.now() })];
    this.save();
    return access;
  }

  private save(): void {
    writeFileAtomic(this.file, `${JSON.stringify({ version: 1, hosts: this.entries }, null, 2)}\n`);
  }
}

/** The bot-side gate of an unattended open (#2723): null lets it through,
 * a string is the refusal the bot reads. `ask` raises the approval card and
 * resolves true when the person allows. */
export async function hostAccessGate(input: {
  access: UnattendedHostAccess;
  hostName: string;
  ask: () => Promise<boolean>;
}): Promise<string | null> {
  if (input.access === "never") {
    return `Refused by Sagax: ${input.hostName} is set to Never allow for bots. The person can change it in Remote sessions.`;
  }
  if (input.access === "ask" && !await input.ask()) {
    return `Refused by Sagax: the person did not allow this session on ${input.hostName}.`;
  }
  return null;
}
