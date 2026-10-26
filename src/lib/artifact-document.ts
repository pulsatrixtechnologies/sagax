// An artifact's sandboxed document: the widget document every chat widget
// gets (rich-blocks buildWidgetDocument: CSP with no network, opaque origin,
// the Sagax kit and theme), plus a small bridge that hands the widget its
// source's JSON. The bridge listens only to its parent window and only to
// one message type; it never posts anything back but the height reporter's
// number.
import { buildWidgetDocument } from "@/lib/rich-blocks";
import type { WidgetTheme } from "@/lib/widget-kit";
import { ARTIFACT_DATA_MESSAGE } from "../../shared/artifacts";
import { ARTIFACT_ERROR_MESSAGE } from "./artifact-frame";

// written as escapes: the raw characters end a line inside a regex literal
const LINE_SEPARATOR = new RegExp("\\u2028", "g");
const PARAGRAPH_SEPARATOR = new RegExp("\\u2029", "g");

/** JSON that is safe inside an inline <script>: no tag can close it. */
export function scriptJson(value: unknown): string {
  return (JSON.stringify(value ?? null) ?? "null")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(LINE_SEPARATOR, "\\u2028")
    .replace(PARAGRAPH_SEPARATOR, "\\u2029");
}

/** window.sagax.data is the last data; window.sagax.onData(fn) calls fn
 * with each new one (and once at once when data is already there). */
export function artifactBridge(initial: unknown, at: number | null): string {
  return `<script>(function(){var handlers=[];var api={data:${scriptJson(initial)},updatedAt:${at === null ? "null" : String(at)},onData:function(fn){if(typeof fn!=="function")return;handlers.push(fn);if(api.data!==null&&api.data!==undefined){try{fn(api.data,api.updatedAt);}catch(e){console.error(e);}}}};`
    + `Object.defineProperty(window,"sagax",{value:api,writable:false,configurable:false});`
    + `addEventListener("message",function(event){if(event.source!==parent)return;var m=event.data;if(!m||m.type!==${JSON.stringify(ARTIFACT_DATA_MESSAGE)})return;api.data=m.data;api.updatedAt=typeof m.at==="number"?m.at:null;`
    + `for(var i=0;i<handlers.length;i++){try{handlers[i](api.data,api.updatedAt);}catch(e){console.error(e);}}try{dispatchEvent(new CustomEvent("sagax:data",{detail:api.data}));}catch(e){}});`
    + `addEventListener("error",function(){try{parent.postMessage({type:${JSON.stringify(ARTIFACT_ERROR_MESSAGE)}},"*");}catch(e){}});})();</script>`;
}

export function buildArtifactDocument(html: string, theme: WidgetTheme | "light" | "dark", font: string, data: { value: unknown; at: number } | undefined): string {
  // the bridge goes before the widget's own markup, so its scripts can read
  // window.sagax as they run
  return buildWidgetDocument(artifactBridge(data?.value ?? null, data?.at ?? null) + html, theme, font);
}
