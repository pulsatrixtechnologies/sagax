// Organization server: which ACP engines may run a turn there, and why an
// engine is refused. An engine is admitted only when its driver withholds
// its own shell, file and web tools (capabilities.withholdsHostTools), proved
// with the real CLI (scripts/verify/dev/verify-org-host-tools.ts, docs/code/organization.md "Engines on
// an organization server"). The server refuses the others with 409
// `host_tools`; the picker and the engine card say the same reason.

/** Why an engine stays refused on an organization server. */
export type OrgHostToolsReason =
  /** Droid: `droid exec -o acp` ignores --only-tools and --remove-tools. */
  | "acp-ignores-selection"
  /** Cursor Agent: Cursor's service picks the tools and the model. */
  | "service-chosen-tools"
  /** Any other engine: no verified way to hold its tools back. */
  | "unverified";

const REFUSED: Readonly<Record<string, OrgHostToolsReason>> = {
  droidAgent: "acp-ignores-selection",
  cursorAgent: "service-chosen-tools",
};

export function orgHostToolsReason(driverKind: string): OrgHostToolsReason {
  return REFUSED[driverKind] ?? "unverified";
}

const WHY: Readonly<Record<OrgHostToolsReason, string>> = {
  "acp-ignores-selection": "Its ACP mode ignores the tool selection, so its shell and file tools would run there.",
  "service-chosen-tools": "Its service chooses the tools it offers, and no setting removes its shell and file tools.",
  unverified: "No setting that removes its shell and file tools has been verified.",
};

/** The 409 `host_tools` message (English; the client shows the same words
 * from its catalog: model.org.hostTools and model.org.hostToolsWhy.*). */
export function orgHostToolsRefusal(name: string, driverKind: string): string {
  return `${name} cannot hold back its own tools on this server. ${WHY[orgHostToolsReason(driverKind)]}`;
}
