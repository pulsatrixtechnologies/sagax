// Connect Apps > Plugins > Yours: a plugin the person installed from a
// marketplace joins the product group of the organization gateway it is
// about (a "ConnectWise" bundle of 15 connectors and the "connectwise"
// plugin of skills are one card, "15 connectors · 4 skills"), instead of
// standing alone under "Added by you".
//
// The rule is declared once, here, and generic: a plugin belongs to a
// product group when its name IS the group's name, compared without case,
// accents, spaces or punctuation ("connectwise", "ConnectWise" and
// "Connect-Wise" are one name). The plugin format has no field naming the
// product a plugin is for (its `category` is a kind of use, "productivity"),
// so nothing is guessed from a description or a partial word: "connectwise"
// never joins a group named "ConnectWise Manage", nor "bookstack-tools" a
// group named "BookStack". A plugin that matches no group stays under
// "Added by you".

/** A name reduced to what tells it apart: lower case, no accent, letters and digits only. */
export function productMatchKey(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The product group a vendor (bundle) stands for: its key and its name. */
export interface ProductGroupRef {
  key: string;
  name: string;
}

/** An installed entry, as far as the rule reads it: its key and the row that stands for it. */
export interface PluginEntryRef {
  key: string;
  primary: { kind: string; name: string };
}

export interface ProductPlugins<E> {
  /** each group's plugins, by the group's key (a group without one is absent) */
  byGroup: Map<string, E[]>;
  /** each grouped entry's group key: these entries leave "Added by you" */
  groupOf: Map<string, string>;
}

/** The installed marketplace plugins of each product group. Only an entry
 * whose row is a plugin joins a group; the first group of a name wins when
 * two share it. */
export function productPlugins<E extends PluginEntryRef>(groups: readonly ProductGroupRef[], entries: readonly E[]): ProductPlugins<E> {
  const byName = new Map<string, string>();
  for (const group of groups) {
    const name = productMatchKey(group.name);
    if (name && !byName.has(name)) byName.set(name, group.key);
  }
  const byGroup = new Map<string, E[]>();
  const groupOf = new Map<string, string>();
  for (const entry of entries) {
    if (entry.primary.kind !== "plugin") continue;
    const group = byName.get(productMatchKey(entry.primary.name));
    if (!group) continue;
    byGroup.set(group, [...(byGroup.get(group) ?? []), entry]);
    groupOf.set(entry.key, group);
  }
  return { byGroup, groupOf };
}
