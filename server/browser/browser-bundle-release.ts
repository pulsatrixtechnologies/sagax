// Reviewed vendor assets, downloaded and hashed on 2026-10-03. Update all
// pins together and run each platform's packaged, offline browser smoke test.
// This is Chromium's headless shell, not full Chrome (which includes Widevine).
import { join } from "node:path";
import {
  agentBrowserReleaseUrl,
  agentBrowserReleaseVersion,
  resolveAgentBrowserReleaseAsset,
} from "./browser-engine-release.ts";

export const CHROME_VERSION = "154.0.8037.92";
export const SUPPORTED_BROWSER_TARGETS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"] as const;
export type BrowserBundleTarget = typeof SUPPORTED_BROWSER_TARGETS[number];

const CHROME_ASSETS = {
  "darwin-arm64": { platform: "mac-arm64", bytes: 99221129, sha256: "77da14e75d7f2568e6f7898d3df7cdc6faac74b15e903b2c9d486ebb6ca9b929", executableSha256: "c50c0bb97ff41124ce9a725710c9ba015b234e0ffa74d108219c34e1bf5cc336" },
  "darwin-x64": { platform: "mac-x64", bytes: 104748425, sha256: "a54292aaacbb77f76f6ef47558e7c51ab884044e0adacca315567f83c060bcc4", executableSha256: "a5fa24efa06900a95a8da50daeab9cdb845a4195eea8deb4be9f3b097f27e8b4" },
  "linux-arm64": { platform: "linux-arm64", bytes: 121182296, sha256: "0ed0e47d9e9f639197f508d62ada09e5c6b4c4c60edab3160a9312a733091df6", executableSha256: "8ef1e673b0083695a65e383dedf07fca9ecc1cffebf02b92c0059eb3879d8a9e" },
  "linux-x64": { platform: "linux64", bytes: 120477194, sha256: "636aa5c79f2693632e9921b8bbb050038ba11672e02346c06c20f991aed096f9", executableSha256: "7c141b276aacc74fe51f06986345fb0dbce0e3756413746fb18541b878c17706" },
  "win32-x64": { platform: "win64", bytes: 120822223, sha256: "3ac2561f02d9d87aadc0399d00b9002d718a4c365624fa67db9e7bfaf6b1a568", executableSha256: "798971a4fb66ed219f2cae1e6a0e97ad68a2e935d5e140d7150745b063dea65b" },
} as const;

export function browserBundleSpec(target: string) {
  if (!Object.hasOwn(CHROME_ASSETS, target)) throw new Error(`Unsupported desktop browser target: ${target}`);
  const pinned = CHROME_ASSETS[target as BrowserBundleTarget];
  const [platform, arch] = target.split("-");
  const engine = resolveAgentBrowserReleaseAsset(platform as NodeJS.Platform, arch)!;
  const suffix = platform === "win32" ? ".exe" : "";
  const directory = `chrome-headless-shell-${pinned.platform}`;
  return {
    schemaVersion: 1,
    target,
    engine: {
      version: agentBrowserReleaseVersion(engine),
      asset: engine.asset,
      url: agentBrowserReleaseUrl(engine),
      bytes: engine.bytes,
      sha256: engine.sha256,
      executable: `agent-browser${suffix}`,
    },
    chrome: {
      version: CHROME_VERSION,
      asset: `${directory}.zip`,
      url: `https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/${pinned.platform}/${directory}.zip`,
      bytes: pinned.bytes,
      sha256: pinned.sha256,
      executableSha256: pinned.executableSha256,
      executable: `chrome/${directory}/chrome-headless-shell${suffix}`,
      license: `chrome/${directory}/LICENSE.headless_shell`,
      about: `chrome/${directory}/ABOUT`,
    },
  };
}

/** bundleDirectory is the target's directory, e.g. Resources/browser-engine. */
export function browserBundlePaths(bundleDirectory: string, target: string) {
  const spec = browserBundleSpec(target);
  return {
    directory: bundleDirectory,
    manifest: join(bundleDirectory, "manifest.json"),
    engine: join(bundleDirectory, spec.engine.executable),
    chrome: join(bundleDirectory, spec.chrome.executable),
    licenses: join(bundleDirectory, "licenses"),
  };
}
