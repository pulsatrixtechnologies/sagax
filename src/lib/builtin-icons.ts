// The icon every built-in plugin, connector and skill the app ships has
// (#4503, the owner: "every plugins will need to have icons that we ship so
// it looks good"): a simple line glyph in the app's icon style (the app's own
// SVG set), chosen by what the item is for, legible at 20 px and at 40 px in
// both themes. A site's own mark (its favicon) still shows first where the
// catalog has one; this is what an item shows when it has none, or when the
// mark cannot load. An organization item shows the icon its console serves;
// an item with no icon at all gets the one neutral tile (never a coloured one).
import {
  AtSign, BarChart3, Bug, Calendar, Clapperboard, Cloud, Contact, CreditCard, Database, FileText, FolderTree, HardDrive,
  Handshake, Images, LayoutGrid, Library, ListChecks, ListTodo, Mail, MessageCircle, MessageSquare, MessagesSquare, Music, Network,
  PenTool, Palette, ScanSearch, ShieldCheck, Smartphone, Smile, StickyNote, Triangle, Wallet, Zap, BookOpen,
  type LucideIcon,
} from "lucide-react";

/** Keyed `<family>:<id>`: app (the reviewed catalog), plugin (built-in), grok
 * (its cloud connectors), mac (the Mac apps), skill (the shipped skills),
 * special (Tailscale). */
export const BUILTIN_GLYPHS: Readonly<Record<string, LucideIcon>> = {
  "app:notion": FileText,
  "app:linear": ListChecks,
  "app:atlassian": LayoutGrid,
  "app:asana": ListTodo,
  "app:sentry": Bug,
  "app:stripe": CreditCard,
  "app:vercel": Triangle,
  "app:figma": PenTool,
  "app:canva": Palette,
  "app:higgsfield": Clapperboard,
  "app:supabase": Database,
  "app:neon": Zap,
  "app:paypal": Wallet,
  "app:intercom": MessageCircle,
  "app:huggingface": Smile,
  "app:context7": BookOpen,
  "app:deepwiki": Library,
  "app:cloudflare-docs": Cloud,
  "plugin:rea": ScanSearch,
  "grok:outlook": Mail,
  "grok:microsoft-teams": MessagesSquare,
  "grok:x": AtSign,
  "grok:gmail": Mail,
  "grok:google-drive": HardDrive,
  "grok:onedrive": Cloud,
  "grok:sharepoint": FolderTree,
  "grok:salesforce": Handshake,
  "mac:messages": MessageSquare,
  "mac:mail": Mail,
  "mac:calendar": Calendar,
  "mac:contacts": Contact,
  "mac:reminders": ListChecks,
  "mac:notes": StickyNote,
  "mac:photos": Images,
  "mac:music": Music,
  "skill:create-verification-skill": ShieldCheck,
  "skill:data-dashboards": BarChart3,
  "skill:phone-harness": Smartphone,
  "special:tailscale": Network,
};

/** The glyph of a built-in item by its row key (`featured:notion`,
 * `grok:outlook`, `builtin:rea`, `skill:data-dashboards`, `tailscale`...), or
 * undefined when the item is not a built-in one. */
export function builtinGlyph(item: { key?: string; kind?: string; id?: string }): LucideIcon | undefined {
  const key = item.key ?? "";
  const id = item.id ?? key.slice(key.indexOf(":") + 1);
  if (key === "tailscale" || key.startsWith("tailscale")) return BUILTIN_GLYPHS["special:tailscale"];
  if (key.startsWith("featured:") || item.kind === "featured") return BUILTIN_GLYPHS[`app:${id}`];
  if (key.startsWith("grok:")) return BUILTIN_GLYPHS[`grok:${id}`];
  if (key.startsWith("builtin:")) return BUILTIN_GLYPHS[`plugin:${id}`];
  if (key.startsWith("mac-")) return BUILTIN_GLYPHS[`mac:${key.slice(4)}`];
  if (key.startsWith("skill:") || item.kind === "skill") return BUILTIN_GLYPHS[`skill:${id}`];
  return BUILTIN_GLYPHS[key] ?? BUILTIN_GLYPHS[`app:${id}`];
}
