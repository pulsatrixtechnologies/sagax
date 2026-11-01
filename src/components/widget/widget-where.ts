/** What a node needs to know about where it is drawn. */
export interface WidgetWhere {
  /** The direction its parent lays its children out in. */
  axis: "row" | "col";
  /** The room its parent leaves under it, before the next child. */
  gap: number;
  /** Inside a list row, where every line is one line. */
  item?: boolean;
  /** The first thing in a list row: an icon or image there is its thumbnail. */
  lead?: boolean;
  /** A direct child of the card, with the card's padding: a Row there is a
   * key-value row, and a flush node runs out to these edges. */
  card?: { top: number; left: number; right: number };
  /** The room a Divider leaves before and after itself when it names none. */
  room?: readonly [number, number];
  /** Already inside a Form: a Form further in is a plain box. */
  form?: boolean;
  /** Inside a table cell: text takes the table's own size and wrapping unless it names its own. */
  cell?: boolean;
}
