const HELD_OR_READ_ONLY = new Set(["EPERM", "EACCES", "EBUSY", "EROFS"]);

export function botsSaveFailure(action: string, code: unknown): string {
  const reason = typeof code === "string" && HELD_OR_READ_ONLY.has(code)
    ? "another program is holding Sagax's bots.json, or its folder is read-only"
    : "Sagax couldn't write bots.json";
  return `Couldn't save ${action}: ${reason}.`;
}
