// Which record of another plugin opens its own window (M-20261127-141,
// M-20261127-146), in the one record window of every record (M-20261127-101):
// a record names its product (the console's product id: the catalog's, with
// an instance's prefix for a second one) and its kind. The window is chosen
// here and nowhere else, like the ticket's in RecordLink.tsx.
//
// A threat by its kind alone (the kind is generic; no invented or real
// catalog id in the rule), a protected system of Axcient x360Recover, a page
// of BookStack, a message of Twilio (its conversation), a post of X, and a
// folder of any plugin that serves files: the Finder's look whatever the
// plugin. Any other record keeps the card's facts in the frame.
import type { RecordRef } from "../../../../shared/record-cards";

export const PLUGIN_WINDOWS = ["threat", "backup", "page", "conversation", "post", "folder"] as const;
export type PluginWindowKind = (typeof PLUGIN_WINDOWS)[number];

/** A product id is its catalog's, alone or after an instance's prefix (`nimbus_bookstack`). */
const of = (...catalogs: string[]) => new RegExp(`(?:^|_)(?:${catalogs.join("|")})$`);

const WINDOWS: ReadonlyArray<{ window: PluginWindowKind; kind: string; product?: RegExp }> = [
  // threat: by kind only (M-20261127-191); never a catalog id in the rule
  { window: "threat", kind: "threat" },
  { window: "backup", kind: "device", product: of("axcient_x360recover") },
  { window: "page", kind: "page", product: of("bookstack") },
  { window: "conversation", kind: "message", product: of("twilio_api") },
  // no plugin serves X yet: the catalog ids it may take (a product id has two characters at least)
  { window: "post", kind: "post", product: of("x_api", "x_com", "twitter") },
  // a folder looks like the Finder whatever plugin serves it
  { window: "folder", kind: "folder" },
];

export function pluginWindowOf(ref: Pick<RecordRef, "product" | "kind">): PluginWindowKind | undefined {
  return WINDOWS.find((one) => one.kind === ref.kind && (!one.product || one.product.test(ref.product)))?.window;
}
