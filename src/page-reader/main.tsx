// The reader's bar around a published page (2026-10-28): the wrapper at
// /pages/view/<token> draws the title and the notice itself; this script
// adds the actions the reader has a right to (shared/page-reader.ts). It
// runs in the wrapper only, never in the page's sandboxed frame.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { parseReaderBoot, READER_ACTIONS_ID, READER_BOOT_ID, READER_MASCOT_ID } from "../../shared/page-reader";
import { watchPageCapabilities } from "./capabilities";
import { ReaderActions } from "./ReaderActions";
import { watchPageSize } from "./print";
import { watchPageState } from "./state";
import "./reader.css";

function boot() {
  try {
    return parseReaderBoot(JSON.parse(document.getElementById(READER_BOOT_ID)?.textContent ?? "null"));
  } catch {
    return null;
  }
}

// Download PDF and the browser's own Print: the page's whole height
watchPageSize(document.querySelector("iframe"));

const config = boot();
// the page's shared state (#1544), for every reader
watchPageState(document.querySelector("iframe"), config);
// what the page may ask of Sagax (#3413): the broker answers its messages with
// this reader's own session; a page that declares nothing is unchanged
const capabilities = config ? watchPageCapabilities(document.querySelector("iframe"), { ...(config.pageId ? { pageId: config.pageId } : {}), signedIn: Boolean(config.me), lang: config.lang }) : null;
const mount = document.getElementById(READER_ACTIONS_ID);
if (config && mount) {
  createRoot(mount).render(<StrictMode><ReaderActions boot={config} broker={capabilities?.broker ?? null} /></StrictMode>);
}

// the publishing bot's mascot in the byline (2026-10-29), once the bar is
// there: its own chunk, the dot in the bot's color stays until it draws
const mascot = document.getElementById(READER_MASCOT_ID);
if (config?.bot && mascot) {
  const bot = config.bot;
  void import("./ReaderMascot").then(({ ReaderMascot }) => {
    createRoot(mascot).render(<StrictMode><ReaderMascot color={bot.color} look={bot.look} size={18} /></StrictMode>);
  }).catch(() => {
    // the dot stays
  });
}
