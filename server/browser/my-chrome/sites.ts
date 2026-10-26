// My Chrome: the sites (origins) a person allowed the bots to drive in their own
// Chrome. Pure. Port of OpenMausBot #2706 (My Chrome), narrowed by JC's rule
// (2026-10-19): nothing outside the sites the person allowed, one origin at a time.
//
// An allowed site is one exact origin, written the way the credential vault
// writes its sites (shared/credential-vault.ts normalizeVaultDomain), without
// the "*." form: https://host, https://host:port, or http://localhost:port, the
// only plain http. A look-alike host, an IP literal, a user name in the URL or
// another scheme never matches.
import { normalizeVaultDomain } from "../../../shared/credential-vault.ts";

/** The origin of an allowed site, or null when the text is not one. */
export function normalizeMyChromeSite(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes("*")) return null;
  // A full URL keeps only its origin: the person may paste the page they are on.
  let value = trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    let url: URL;
    try { url = new URL(trimmed); } catch { return null; }
    if (url.username || url.password) return null;
    value = `${url.protocol}//${url.host}`;
  }
  const domain = normalizeVaultDomain(value);
  if (!domain || domain.startsWith("*.")) return null;
  return domain.startsWith("http://") ? domain : `https://${domain}`;
}

/** The origin of a page URL as My Chrome compares it, or null for a URL that is
 * not http(s) or carries a user name. */
export function pageOrigin(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.username || url.password) return null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.origin.toLowerCase();
}

/** Whether a page at this URL is on one of the allowed sites. */
export function myChromeSiteAllows(sites: readonly string[], raw: string): boolean {
  const origin = pageOrigin(raw);
  return origin !== null && sites.includes(origin);
}

/** A blank page the bot may hold before it opens an allowed site. */
export function isBlankPage(raw: string): boolean {
  return raw === "" || raw === "about:blank";
}
