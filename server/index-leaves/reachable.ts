// @ts-nocheck
/** reachable (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReachable(getHost: () => Host): any {
async function reachable(url: string) {
  const host = getHost();

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "bad_address", label: "The address is not a URL." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, reason: "bad_address", label: "Only http and https addresses can be tested." };
  try {
    const res = await fetch(parsed, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8_000) });
    await res.body?.cancel().catch(host.reportBackgroundError);
    return res.status < 500 ? { ok: true, reason: null, label: null } : { ok: false, reason: "http_error", label: `The server answered ${res.status}.` };
  } catch (error) {
    return { ok: false, reason: "unreachable", label: host.redactSecretsInText(error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error)).slice(0, 300) };
  }

}
  return reachable;
}
