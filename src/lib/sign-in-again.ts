// "Sign in again" (2026-10-18, real path since 2026-10-19): the actions that
// need a sign-in younger than 15 minutes (the first security key, the vault
// export in clear without a key) count only a "Sign in with Pulsatrix"
// whose provider sign-in is itself recent (server/recent-sign-in.ts). An
// email code never counts, so this is the server's Pulsatrix sign-in with
// `fresh=1` (Perspicax asks for the factors again: `prompt=login`,
// `max_age=0`), or nothing on a server without it. The desktop app opens it
// in the system browser (electron/main.mjs guardNavigation) and keeps the
// page.
import { fetchEnvironmentDescriptor } from "@/lib/environment-descriptor";
import { pulsatrixLoginPath, type EnvironmentDescriptor } from "@/lib/session";

/** Where "Sign in again" goes, or null when this server offers no
 * Pulsatrix sign-in (or cannot say): nothing here can give a recent sign-in. */
export async function signInAgainPath(load: () => Promise<Response> = () => fetchEnvironmentDescriptor()): Promise<string | null> {
  try {
    const response = await load();
    if (!response.ok) return null;
    const path = pulsatrixLoginPath(await response.json() as EnvironmentDescriptor);
    return path ? `${path}?fresh=1` : null;
  } catch {
    return null;
  }
}
