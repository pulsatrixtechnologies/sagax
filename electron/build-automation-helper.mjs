// Build the Automation permission helper (electron/resources/automation-helper.swift)
// as a universal loose binary. It ships in Resources and runs as a child of
// Sagax, so macOS files the Automation grant it asks for under Sagax (the
// responsible app, whose Info.plist carries NSAppleEventsUsageDescription).
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.dirname(electronDir);
const resourcesDir = path.join(electronDir, "resources");

export const automationHelperBinary = path.join(resourcesDir, "automation-helper");

export function buildAutomationHelper() {
  // Universal like the app: the helper rides in the arm64 and the x64 bundle.
  const slices = ["arm64", "x86_64"].map((arch) => {
    const slice = `${automationHelperBinary}-${arch}`;
    execFileSync(
      "swiftc",
      ["-O", "-target", `${arch}-apple-macos12`, path.join(resourcesDir, "automation-helper.swift"), "-o", slice],
      { stdio: "inherit", timeout: 120_000 },
    );
    return slice;
  });
  execFileSync("lipo", ["-create", ...slices, "-output", automationHelperBinary], { stdio: "inherit", timeout: 60_000 });
  for (const slice of slices) rmSync(slice, { force: true });
  const archs = execFileSync("lipo", ["-archs", automationHelperBinary], { timeout: 60_000 }).toString();
  if (!archs.includes("arm64") || !archs.includes("x86_64")) {
    throw new Error(`automation helper is not universal: ${archs.trim()}`);
  }
  // Ad-hoc for development; electron-builder re-signs it with the app identity
  // and the inherited entitlements (com.apple.security.automation.apple-events).
  execFileSync(
    "codesign",
    ["--force", "--sign", "-", "--options", "runtime", "--entitlements", path.join(projectDir, "build", "entitlements.mac.plist"), automationHelperBinary],
    { stdio: "inherit", timeout: 30_000 },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildAutomationHelper();
}
