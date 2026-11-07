import { useEffect, useState, type RefObject } from "react";

/**
 * The card's two timers: the live uptime clock (once a second while it
 * shows) and the link expiry (a link that expires while the card sits idle
 * flips to the refresh panel). Returns the clock's current time.
 */
export function useVideoClocks({
  videoRef,
  isLive,
  startedAt,
  expiresAt,
  expired,
  showcase,
  markExpired,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  isLive: boolean;
  startedAt?: string;
  expiresAt?: number;
  expired: boolean;
  showcase?: boolean;
  markExpired: () => void;
}): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isLive || !startedAt || showcase) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [isLive, startedAt, showcase]);

  useEffect(() => {
    if (showcase || !expiresAt || expired) return;
    const left = expiresAt - Date.now();
    if (left <= 0 || left > 2 ** 31 - 1) return;
    const timer = setTimeout(() => {
      if (videoRef.current?.paused !== false) markExpired();
    }, left);
    return () => clearTimeout(timer);
  }, [videoRef, expiresAt, expired, showcase, markExpired]);

  return now;
}
