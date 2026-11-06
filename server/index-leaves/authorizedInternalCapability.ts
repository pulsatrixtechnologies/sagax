// @ts-nocheck
/** authorizedInternalCapability (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAuthorizedInternalCapability(getHost: () => Host): any {
function authorizedInternalCapability(header: string | string[] | undefined) {
  const host = getHost();

  const got = Buffer.from(Array.isArray(header) ? "" : (header ?? ""));
  for (const [token, capability] of host.internalCapabilities) {
    if (!host.internalCapabilityIsActive(capability)) {
      host.internalCapabilities.delete(token);
      continue;
    }
    const expected = Buffer.from(`Bearer ${token}`);
    if (got.length === expected.length && timingSafeEqual(got, expected)) return capability;
  }
  return host.externalRuntimeCapability(header);

}
  return authorizedInternalCapability;
}
