// A server's public descriptor. Served at /.well-known/sagax/environment and,
// kept on purpose (docs/code/repository.md, "Legacy names kept for compatibility"), at
// /.well-known/openmausbot/environment, which is all a
// server from before Sagax serves (electron/legacy-names.mjs). The page may
// be this app's own bundle drawing an older organization server, so it asks
// for the new path first and falls back on a 404 only.
export const ENVIRONMENT_PATH = "/.well-known/sagax/environment";
export const LEGACY_ENVIRONMENT_PATH = "/.well-known/openmausbot/environment";

export async function fetchEnvironmentDescriptor(init?: RequestInit, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const response = await fetchImpl(ENVIRONMENT_PATH, init);
  return response.status === 404 ? fetchImpl(LEGACY_ENVIRONMENT_PATH, init) : response;
}
