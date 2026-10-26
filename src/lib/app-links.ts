// The handful of outward links the app offers from the profile menu and the
// About dialog. They are collected here so "where does Help go?" has one
// answer rather than one per call site.
export const APP_NAME = "Sagax";
/** The full brand, sibling of Pulsatrix Perspicax: the About dialog. */
export const APP_FULL_NAME = "Pulsatrix Sagax";
export const APP_REPOSITORY = "https://github.com/pulsatrixtechnologies/sagax";
/** Help, docs, and the license all open this fork. */
export const DOCS_URL = `${APP_REPOSITORY}/tree/main/docs`;
export const HELP_CENTER_URL = DOCS_URL;
export const APPROVAL_LEVELS_URL = `${APP_REPOSITORY}/blob/main/docs/approval-levels.md`;
/** No upstream Pro offer: the original project's site is never linked. */
export const PRO_URL = "";
/** No upstream plans page either. */
export const PRICING_URL = "";
export const LICENSE_URL = `${APP_REPOSITORY}/blob/main/LICENSE`;

/** Fork version Vite inlined from package.json forkVersion. "dev" outside the bundler. */
export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
}

/** Official OpenMausBot (upstream) release this fork is based on. Stays on that line. */
export function baseVersion(): string {
  return typeof __BASE_VERSION__ === "string" ? __BASE_VERSION__ : "dev";
}

const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

/** "macOS", "Windows", "Linux" — or nothing at all in the browser, where the
 * host OS is not ours to claim. */
export function platformLabel(platform?: string): string | null {
  return (platform && PLATFORM_NAMES[platform]) ?? null;
}

/** Hands a link to the default browser through the preload bridge, falling
 * back to a new tab when the app runs in a plain browser. A bridge the main
 * process refuses for this page (desktopUiOnly) used to end in a silent
 * rejection behind `void`, so the button did nothing: the refusal is logged
 * and the window's own link path (setWindowOpenHandler: the default browser,
 * web links only) takes over. When that fails too, the caller gets an error
 * to show. */
export async function openExternalLink(url: string): Promise<void> {
  if (window.ogb?.openExternal) {
    try {
      await window.ogb.openExternal(url);
      return;
    } catch (error) {
      console.warn("desktop:open-external refused the link; trying the window's link path", error);
    }
  }
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (error) {
    console.warn("The link could not be opened", error);
    throw new Error(`The link could not be opened: ${url}`, { cause: error });
  }
}
