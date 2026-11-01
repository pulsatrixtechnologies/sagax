/**
 * Detect whether the current host platform is macOS.
 * Checks Electron's window.ogb bridge first, falling back to navigator.userAgent.
 */
export function isMacPlatform(): boolean {
  if (typeof window !== "undefined" && window.ogb?.platform) {
    return window.ogb.platform === "darwin";
  }
  if (typeof navigator !== "undefined" && navigator.userAgent) {
    return navigator.userAgent.includes("Mac");
  }
  return true;
}
