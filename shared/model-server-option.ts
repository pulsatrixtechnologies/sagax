// A pi model server's rows (#2963): Perspicax resolves the person's own and
// the organization's model servers per turn (server/drivers/pi-model-servers.ts)
// and lists their models on the pi engine as `px-org-<name>/<model>` or
// `px-own-<name>/<model>`. They are custom rows, but they run with the
// organization's or the person's server, never a model typed on this machine.

/** Whether a pi provider id names a Perspicax model server. */
export function isModelServerProvider(provider: string): boolean {
  return /^px-(org|own)-[a-z0-9][a-z0-9-]*$/.test(provider);
}

/** Whether a catalog row is a Perspicax model server's model. */
export function isModelServerOption(option: { id: string; custom?: boolean; provider?: string }): boolean {
  if (!option.custom) return false;
  return isModelServerProvider(option.provider ?? option.id.split("/")[0] ?? "");
}
