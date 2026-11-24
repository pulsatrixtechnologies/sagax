/** The context menu's entries for an image (#5226). Without them a right-click
 * on an image in a conversation opened no menu at all: the menu was only built
 * for editable fields, links and selections. */

/** True when the pointer is on an image Chromium has decoded. */
function imageTarget(params) {
  return params.mediaType === "image" && params.hasImageContents === true;
}

/** What the menu's text entries (Undo to Select All) answer to. */
export function textMenuTarget(params) {
  return Boolean(params.isEditable || params.linkURL || params.misspelledWord || params.selectionText);
}

/** Nothing actionable means no menu at all, rather than a wall of disabled items. */
export function hasContextMenu(params) {
  return textMenuTarget(params) || imageTarget(params);
}

/** "Copy Image" puts the image under the pointer in the clipboard; Chromium
 * owns the decoding, nothing is fetched or sent over IPC. */
export function imageMenuItems(params, webContents) {
  if (!imageTarget(params)) return [];
  return [{ label: "Copy Image", click: () => webContents.copyImageAt(params.x, params.y) }];
}
