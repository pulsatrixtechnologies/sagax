// Settings > Appearance > Accessibility (parity 2E): motion, contrast and
// text size, each kept on this computer and followed across the person's
// devices on an organization server (shared/user-preferences.ts). They are
// written on <html> as data attributes the stylesheet reads (styles.css).
import { localChoice } from "./local-choice";

export const MOTION_CHOICES = ["system", "reduce"] as const;
export const CONTRAST_CHOICES = ["system", "high"] as const;
export const TEXT_SIZE_CHOICES = ["default", "large", "xlarge"] as const;

export const TEXT_SIZE_ZOOM: Record<(typeof TEXT_SIZE_CHOICES)[number], number> = { default: 1, large: 1.1, xlarge: 1.25 };

export const motionChoice = localChoice("sagax.a11y.motion.v1", MOTION_CHOICES, "system");
export const contrastChoice = localChoice("sagax.a11y.contrast.v1", CONTRAST_CHOICES, "system");
export const textSizeChoice = localChoice("sagax.a11y.textSize.v1", TEXT_SIZE_CHOICES, "default");

/** Write the three choices on the root element. "system" and "default"
 * leave no attribute, so the system's own setting stays in charge. */
export function applyAccessibility(root: HTMLElement = document.documentElement): void {
  if (motionChoice.get() === "reduce") root.setAttribute("data-reduced-motion", "true");
  else root.removeAttribute("data-reduced-motion");
  if (contrastChoice.get() === "high") root.setAttribute("data-contrast", "high");
  else root.removeAttribute("data-contrast");
  const size = textSizeChoice.get();
  if (size === "default") root.removeAttribute("data-text-size");
  else root.setAttribute("data-text-size", size);
  // The desktop app zooms the window itself (viewport units stay true); a
  // plain browser falls back to the stylesheet's zoom.
  const native = typeof window !== "undefined" ? window.ogb?.shellPreferences?.setZoom?.(TEXT_SIZE_ZOOM[size]) === true : false;
  if (native) root.setAttribute("data-zoom-native", "1");
  else root.removeAttribute("data-zoom-native");
}

/** Apply now, then again whenever a choice changes (this window, another
 * window, a bot, the person's other device). Returns the stop function. */
export function installAccessibility(): () => void {
  applyAccessibility();
  const stops = [motionChoice, contrastChoice, textSizeChoice].map((choice) => choice.subscribe(applyAccessibility));
  return () => stops.forEach((stop) => stop());
}
