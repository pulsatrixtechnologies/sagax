// Pure helpers for the Windows desktop install smoke (#5322).
// The workflow resolves the published reference from latest.yml; the
// PowerShell verifier picks Sagax.exe beside the registered uninstaller,
// with a shortcut fallback when the install folder is briefly incomplete
// (seen on arm64 for 0.8.170).

/**
 * @param {string} text
 * @returns {{ version: string, sha512: string, setupFile: string }}
 */
export function parseLatestYml(text) {
  const version = text.match(/^version:\s*(\S+)\s*$/m)?.[1];
  const setupFile = text.match(/^\s*-\s*url:\s*(\S*setup\.exe)\s*$/m)?.[1]
    ?? text.match(/^path:\s*(\S*setup\.exe)\s*$/m)?.[1];
  const sha512 = text.match(/^sha512:\s*(\S+)\s*$/m)?.[1];
  if (!version || !setupFile || !sha512) {
    throw new Error("latest.yml is missing version, setup.exe path or sha512");
  }
  return { version, sha512, setupFile };
}

/**
 * @param {{ version: string, setupFile: string, owner?: string, repo?: string }} meta
 */
export function referenceSetupUrl(meta) {
  const owner = meta.owner ?? "pulsatrixtechnologies";
  const repo = meta.repo ?? "sagax";
  return `https://github.com/${owner}/${repo}/releases/download/pulsa-v${meta.version}/${meta.setupFile}`;
}

/**
 * Candidates for the installed Sagax.exe, in preference order.
 * @param {{ uninstallerPath: string, shortcutTargets?: string[] }} input
 * @returns {string[]}
 */
export function sagaxExeCandidates(input) {
  const dir = input.uninstallerPath.replace(/[\\/][^\\/]+$/, "");
  const beside = `${dir}${dir.includes("\\") ? "\\" : "/"}Sagax.exe`;
  const seen = new Set();
  const out = [];
  for (const path of [beside, ...(input.shortcutTargets ?? [])]) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

/**
 * Pick the first existing Sagax.exe among the candidates.
 * @param {string[]} candidates
 * @param {(path: string) => boolean} exists
 */
export function pickInstalledSagaxExe(candidates, exists) {
  for (const path of candidates) {
    if (exists(path)) return path;
  }
  return null;
}
