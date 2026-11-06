// Settings > Appearance > App icon, without the picker on screen (#1545): a
// bot sets the person's app icon by its id, drawn exactly as the picker draws
// it (the app's own avatar component off screen, then the system template),
// and handed to the desktop app the same way.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { BotAvatar } from "@/components/Avatar";
import { appIconLock, currentUnlocks, reportAchievement } from "@/lib/achievements";
import { DEFAULT_APP_ICON_ID, appIconTargets, withPrimaryChoice, type AppIconArt, type AppIconChoice } from "@/lib/app-icon-choices";
import { appIconGlyphSvg } from "@/lib/app-icon-glyphs";
import { elementToArt, loadImage, renderAppIcon, type IconArt } from "@/lib/app-icon-render";

export const APP_ICON_STAGE = 256;

type BotLike = Parameters<typeof BotAvatar>[0]["bot"];

/** The bot the app's own avatar component draws for a choice. */
export function stageBot(art: AppIconArt, bots: readonly (BotLike & { id: string })[]): BotLike | null {
  switch (art.kind) {
    case "owl":
      return { name: "Sagax", color: art.color, mascotSkin: art.skin };
    case "shape":
      return { name: "Sagax", color: art.color, mascotLook: { character: "shape", shape: art.shape, skins: { shape: art.skin } } };
    case "trombi":
      return { name: "Trombi", color: "blue", mascotLook: { character: "trombi", skins: { trombi: art.skin } } };
    case "bunbu":
      return { name: "Bunbu", color: art.color, mascotLook: { character: "bunbu", skins: { bunbu: art.skin } } };
    case "shiba":
      return { name: "Shiba", color: art.color, mascotLook: { character: "shiba", skins: { shiba: art.skin } } };
    case "grump":
      return { name: "Grump", color: art.color, mascotLook: { character: "grump", skins: { grump: art.skin } } };
    case "ogre":
      return { name: "Ogre", color: art.color, mascotLook: { character: "ogre", skins: { ogre: art.skin } } };
    case "frog":
      return { name: "Frog", color: art.color, mascotLook: { character: "frog", skins: { frog: art.skin } } };
    case "crab":
      return { name: "Crab", color: art.color, mascotLook: { character: "crab", skins: { crab: art.skin } } };
    case "primary":
      return bots.find((bot) => bot.id === art.botId) ?? null;
    default:
      return null;
  }
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** A character drawn off screen by the avatar component, as the picker's stage does. */
async function stagedArt(bot: BotLike): Promise<IconArt | null> {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${APP_ICON_STAGE}px;height:${APP_ICON_STAGE}px;pointer-events:none`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() => root.render(<BotAvatar bot={bot} size={APP_ICON_STAGE} animated={false} label="" />));
    await nextFrame();
    await nextFrame();
    return await elementToArt(host, APP_ICON_STAGE * 3);
  } finally {
    root.unmount();
    host.remove();
  }
}

/** Show the app icon `id` (one Settings offers this person). The id now shown. */
export async function applyAppIconById(id: string, input: { bots: readonly (BotLike & { id: string })[]; primary: { id: string } | null }): Promise<string> {
  const bridge = window.ogb?.appIcon;
  if (!bridge) throw new Error("This app has no app icon to change.");
  const choices: readonly AppIconChoice[] = withPrimaryChoice(input.primary);
  const choice = choices.find((row) => row.id === id);
  if (!choice) throw new Error(`No such app icon. The choices: ${choices.map((row) => row.id).join(", ")}.`);
  if (appIconLock(currentUnlocks(), choice.id, choice.art as { kind: string; skin?: string }).locked) throw new Error("This app icon is not unlocked yet for this person.");
  if (choice.id === DEFAULT_APP_ICON_ID) return (await bridge.reset()).id ?? DEFAULT_APP_ICON_ID;
  let art: IconArt | null = null;
  if (choice.art.kind === "image") art = { image: await loadImage(choice.art.src), width: 1024, height: 1024 };
  else if (choice.art.kind === "glyph") art = { image: await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(appIconGlyphSvg(choice.art.glyph))}`), width: 512, height: 512 };
  else {
    const bot = stageBot(choice.art, input.bots);
    art = bot ? await stagedArt(bot) : null;
  }
  if (!art) throw new Error("This app icon could not be drawn here.");
  const platform = (await bridge.get()).platform;
  const { template, sizes } = appIconTargets(platform);
  const drawn = art;
  const images = sizes.map((size) => ({ size, png: renderAppIcon(template, size, drawn, choice).toDataURL("image/png") }));
  const saved = await bridge.set({ id: choice.id, images });
  reportAchievement("appicon.changed");
  return saved.id ?? DEFAULT_APP_ICON_ID;
}
