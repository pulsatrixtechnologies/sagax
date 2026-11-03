export interface ClaudeAccountInput {
  signedIn?: boolean;
  loginMarker?: boolean;
  anthropicConfigured?: boolean;
  myKey?: boolean;
  orgKey?: boolean;
}

export function claudeAccountLinked(input: ClaudeAccountInput): boolean {
  if (input.signedIn || input.loginMarker) return true;
  if (input.anthropicConfigured || input.myKey) return true;
  return false;
}

/** One process-lifetime CLI probe. Later calls reuse it and must not spawn again. */
export interface SoloClaudeLinkCache {
  probe: Promise<boolean> | null;
}

/**
 * Solo reconcile. A login marker or an own Anthropic key is enough.
 * When both are absent, `probe` runs once (`claude auth status`), and a
 * signed-in result writes the marker. A later call does not probe again.
 * Never reads `.credentials.json` (Keychain on macOS).
 */
export async function soloClaudeAccountLinked(input: {
  loginMarker: boolean;
  anthropicConfigured: boolean;
  cache: SoloClaudeLinkCache;
  probe: () => Promise<boolean>;
  writeMarker: () => void;
}): Promise<boolean> {
  if (input.loginMarker || input.anthropicConfigured) {
    return claudeAccountLinked({ loginMarker: input.loginMarker, anthropicConfigured: input.anthropicConfigured });
  }
  if (!input.cache.probe) {
    input.cache.probe = Promise.resolve()
      .then(() => input.probe())
      .then((signedIn) => {
        if (!signedIn) return false;
        try { input.writeMarker(); } catch { /* still linked for this process */ }
        return true;
      })
      .catch(() => false);
  }
  const signedIn = await input.cache.probe;
  return claudeAccountLinked({ signedIn });
}
