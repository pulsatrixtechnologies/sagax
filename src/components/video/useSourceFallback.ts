import { useCallback, useState } from "react";

/**
 * Which source plays: the proxied playbackUrl first, then once the original
 * URL (directUrl) when the proxy could not serve it (a refused destination
 * answers 403, an upstream the proxy cannot reach fails).
 */
export function useSourceFallback({
  playbackUrl,
  directUrl: rawDirectUrl,
  onFail,
  onExpired,
}: {
  playbackUrl: string;
  directUrl?: string;
  /** The last source failed: show the error. */
  onFail: () => void;
  /** The last source answered an auth status: the link expired. */
  onExpired: () => void;
}) {
  const [useDirect, setUseDirect] = useState(false);
  const directUrl = rawDirectUrl && rawDirectUrl !== playbackUrl ? rawDirectUrl : undefined;
  const src = useDirect && directUrl ? directUrl : playbackUrl;
  const canFallBack = Boolean(directUrl) && !useDirect;

  /** A source failed for good: try the original URL once, else fail. */
  const failSource = useCallback(() => {
    if (canFallBack) setUseDirect(true);
    else onFail();
  }, [canFallBack, onFail]);

  /** An auth status: the proxy may have refused the destination, so the
   * original URL gets its one try before the link counts as expired. */
  const expireOrFallBack = useCallback(() => {
    if (canFallBack) setUseDirect(true);
    else onExpired();
  }, [canFallBack, onExpired]);

  /** Back to the proxied source; false when it already plays. */
  const resetSource = useCallback(() => {
    if (!useDirect) return false;
    setUseDirect(false);
    return true;
  }, [useDirect]);

  return { src, directUrl, failSource, expireOrFallBack, resetSource };
}
