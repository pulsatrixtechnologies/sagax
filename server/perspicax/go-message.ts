// The GO a Perspicax pack guard asks for one write (Flow: dry run, GO, read
// back) arrives as an elicitation whose message is written by
// connector-core/src/flow/guard.rs `ask_message` / `batch_message`:
//
//   Pulsatrix Flow needs your GO before this write is sent.
//   Tool: cw_psa_write
//   Action: create
//   Record: 299334            (or "Records: [..]")
//   Arguments: {"action":"create","parent":299334,...}
//   Why: the pack asks a GO for every note
//   Allow sends it once; Deny sends nothing.
//
// #2091 (decided 2026-11-05): the card made of it names the tool and the action
// ("Marc wants to create a note in CW PSA", never "wants to perspicax"),
// shows a human line and the raw arguments once, and its Always allow keeps
// a rule for that tool and action. Perspicax itself keeps no per-person
// standing GO: the rule answers the next elicitation on the person's behalf.

export interface GoRequest {
  /** the served tool name (`cw_psa_write`), when the message names one */
  tool?: string;
  /** the write's `action` argument (`create`, `update`, …) */
  action?: string;
  /** `Record:` / `Records:` as written */
  record?: string;
  /** the raw arguments as written (JSON, possibly truncated by the guard) */
  args?: string;
  /** the pack's reason, when it gave one */
  why?: string;
  /** a `flow_action` batch: its action and the number of writes */
  batch?: { action: string; count: number };
  /** the human line of the card: what is written where, and why */
  summary: string;
  /** the Always allow rule's fingerprint: the tool and the action, never
   * the arguments (one rule covers the next note too) */
  fingerprint?: string;
  /** the saved rule's plain words */
  ruleDescription?: string;
}

const BATCH_HEAD = /^Pulsatrix Flow needs your GO before the (\d+) write\(s\) of the action (\S+) are sent/;
const FIELD = /^(Tool|Action|Record|Records|Arguments|Why):\s*(.*)$/;

const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

export function parseGoMessage(message: string): GoRequest {
  const lines = message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const batch = BATCH_HEAD.exec(lines[0] ?? "");
  if (batch) {
    const count = Number(batch[1]);
    const action = batch[2]!;
    // the numbered writes are the batch's raw arguments: folded once on the card
    const writes = lines.slice(1).filter((line) => /^\d+\.\s/.test(line)).join("\n");
    return {
      batch: { action, count },
      ...(writes ? { args: writes } : {}),
      summary: `Pulsatrix Flow asks your GO before the ${count} write${count === 1 ? "" : "s"} of the action ${action} are sent.`,
      fingerprint: `go:flow_action:${action}`,
      ruleDescription: `Send the writes of the Flow action ${action}`,
    };
  }
  const fields: Partial<Record<"Tool" | "Action" | "Record" | "Records" | "Arguments" | "Why", string>> = {};
  for (const line of lines) {
    const match = FIELD.exec(line);
    if (match) fields[match[1] as keyof typeof fields] = match[2]!.trim();
  }
  const tool = fields.Tool?.replace(/[^A-Za-z0-9_.-]/g, "") || undefined;
  const action = fields.Action?.replace(/[^A-Za-z0-9_.-]/g, "") || undefined;
  const record = fields.Record ?? fields.Records;
  const args = fields.Arguments || undefined;
  const why = fields.Why || undefined;
  const parsed = parseArgs(args);
  const resource = typeof parsed?.resource === "string" ? parsed.resource : undefined;
  const parent = parsed?.parent !== undefined && parsed.parent !== null ? String(parsed.parent as string | number) : undefined;
  const what = [
    action ? action[0]!.toUpperCase() + action.slice(1) : "Write",
    resource ?? "",
    parent ? `under ${parent}` : record ? `(record ${record})` : "",
  ].filter(Boolean).join(" ");
  const summary = [
    tool ? sentence(`${what} with ${tool}`) : "",
    "Pulsatrix Flow asks your GO before this write is sent.",
    why ? sentence(`Why: ${why}`) : "",
  ].filter(Boolean).join(" ");
  return {
    ...(tool ? { tool } : {}),
    ...(action ? { action } : {}),
    ...(record ? { record } : {}),
    ...(args ? { args } : {}),
    ...(why ? { why } : {}),
    summary,
    ...(tool ? {
      fingerprint: `go:${tool}:${action ?? "*"}`,
      ruleDescription: `Send ${tool}${action ? ` ${action}` : ""} writes through Pulsatrix Flow`,
    } : {}),
  };
}

function parseArgs(text: string | undefined): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    // the guard truncates long arguments: the names before the cut still read
    const head = /^\{\s*"action"\s*:\s*"([^"]*)"/.exec(text);
    const resource = /"resource"\s*:\s*"([^"]*)"/.exec(text);
    const parent = /"parent"\s*:\s*("?)([^",}\s]*)\1/.exec(text);
    if (!head && !resource && !parent) return undefined;
    return {
      ...(head ? { action: head[1] } : {}),
      ...(resource ? { resource: resource[1] } : {}),
      ...(parent ? { parent: parent[2] } : {}),
    };
  }
}
