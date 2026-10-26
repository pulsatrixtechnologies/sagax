// The HD mascot renderer: a character's painted art (manifest.ts) in the
// same box its vector look would take. Used only for a character with a
// manifest while the person keeps "HD mascots" on; HdOrVector decides.
//
// Loading: the asset URLs are known up front but nothing downloads until a
// mascot draws one (loading="lazy"). Until the first one has decoded, the
// vector drawing shows in the box (no blank, no layout shift); the next
// asset of a change of state loads hidden behind the shown one and swaps in
// once ready. A loop that fails falls back on its still, a still that fails
// on the vector drawing, for good (failures are remembered per URL).
//
// Motion: a loop plays only when the mascot is animated, the box is 48 px
// or more and neither the system nor Settings > Accessibility asks for
// reduced motion; otherwise the matching still shows.
import "./hd-mascot.css";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { motionChoice } from "@/lib/accessibility-preferences";
import { useHdMascots } from "@/lib/hd-mascots-preference";
import { useReducedMotion } from "../skin-fx/skin-fx";
import { hdAssetFor, hdManifestFor, HD_LOOP_MIN_PX, type HdAsset, type HdKey, type HdManifest } from "./manifest";

/** URLs that decoded once (drawn straight away the next time) and URLs that failed (never tried again). */
const loaded = new Set<string>();
const failed = new Set<string>();

/** For tests: forget what loaded or failed. */
export function resetHdMascotCache(): void {
  loaded.clear();
  failed.clear();
}

/** For tests and the fallback: mark a URL as failed or loaded. */
export function markHdAsset(url: string, outcome: "loaded" | "failed"): void {
  (outcome === "loaded" ? loaded : failed).add(url);
  (outcome === "loaded" ? failed : loaded).delete(url);
}

/**
 * What the box draws for an asset, given what loaded or failed: the asset
 * itself, its still when the loop failed, or nothing (the vector drawing)
 * when both failed. Pure, for the tests.
 */
export function hdSourceFor(asset: HdAsset, hasFailed: (url: string) => boolean = (url) => failed.has(url)): string | null {
  if (!hasFailed(asset.src)) return asset.src;
  if (asset.still !== asset.src && !hasFailed(asset.still)) return asset.still;
  return null;
}

export interface HdMascotProps {
  manifest: HdManifest;
  hdKey: HdKey;
  size: number;
  /** Off draws a still (thumbnails). */
  animated?: boolean;
  /** The vector drawing: shown until the art has loaded, and for good if it fails. */
  fallback: ReactNode;
  label?: string | null;
  className?: string;
}

export function HdMascot({ manifest, hdKey, size, animated = true, fallback, label = null, className }: HdMascotProps) {
  const reducedSystem = useReducedMotion();
  const reducedApp = motionChoice.use() === "reduce";
  const moving = animated && !reducedSystem && !reducedApp;
  const asset = hdAssetFor(manifest, hdKey, { moving, size });
  const [, bump] = useState(0);
  const target = hdSourceFor(asset);
  // the art on screen: the last that decoded (kept while the next one loads)
  const [shown, setShown] = useState<string | null>(() => (target && loaded.has(target) ? target : null));
  useEffect(() => {
    if (target && loaded.has(target) && target !== shown) setShown(target);
  }, [target, shown]);
  const showing = shown && !failed.has(shown) ? shown : null;
  const onLoad = (url: string) => {
    markHdAsset(url, "loaded");
    setShown(url);
  };
  const onError = (url: string) => {
    markHdAsset(url, "failed");
    if (shown === url) setShown(null);
    bump((n) => n + 1);
  };
  const bust = size < HD_LOOP_MIN_PX;
  const state = showing ? "ready" : target ? "loading" : "fallback";
  return (
    <span
      className={cn("hd-mascot", bust && showing && "hd-mascot-bust", moving && asset.kind === "still" && showing === target && "hd-mascot-breathe", className)}
      style={{ width: size, height: size }}
      data-character={manifest.character}
      data-hd={state}
      data-hd-asset={asset.id}
      data-hd-kind={asset.kind}
      // the vector drawing carries its own label while it shows
      role={showing && label ? "img" : undefined}
      aria-label={showing ? (label ?? undefined) : undefined}
      aria-hidden={showing && !label ? true : undefined}
    >
      {!showing && fallback}
      {showing && <img className="hd-mascot-art" src={showing} alt="" width={size} height={size} draggable={false} decoding="async" onError={() => onError(showing)} />}
      {target && target !== showing && (
        <img
          key={target}
          className="hd-mascot-art hd-mascot-next"
          src={target}
          alt=""
          width={size}
          height={size}
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={() => onLoad(target)}
          onError={() => onError(target)}
        />
      )}
    </span>
  );
}

/**
 * A character's HD art when it has some and HD mascots are on (and `hd` is
 * not turned off by the caller, as the skin pickers do), else its vector
 * drawing exactly as before.
 */
export function HdOrVector({ character, hd = true, hdKey, size, animated, label, className, children }: { character: string; hd?: boolean; hdKey: HdKey; size: number; animated?: boolean; label?: string | null; className?: string; children: ReactNode }) {
  const enabled = useHdMascots();
  const manifest = hd && enabled ? hdManifestFor(character) : null;
  if (!manifest) return <>{children}</>;
  return <HdMascot manifest={manifest} hdKey={hdKey} size={size} animated={animated} fallback={children} label={label} className={className} />;
}
