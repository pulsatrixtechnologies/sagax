// The bytes a published page is read as (shared/published-pages.ts has the
// isolation rules). An HTML page is the bot's document as written: it runs
// in an opaque-origin sandbox under a CSP with no network, so its scripts
// can only touch their own document. A Markdown page is turned into HTML
// here by a small renderer that escapes every character first and emits
// only a fixed set of tags (no raw HTML, links http(s) and mailto only), and
// it runs no script at all. A link is written as its words and its address
// in plain text: an anchor would be inert in the sandbox anyway.
//
// The reader never lands on the page itself: wrapperDocument is a Sagax page
// with a permanent banner (no script, nothing to dismiss) that embeds the
// page in a frame sandboxed to scripts only, whose navigation the wrapper's
// `frame-src` limits to the page's own frame path.
import { PAGE_ANNOTATION_MESSAGE, PAGE_BANNER_NAME_MAX, PAGE_LIMITS, pageCsp, pageFrameSandbox, type PageKind, type ReaderComment } from "../shared/published-pages.ts";

/** Server side, before every HTML version is served: no element that can
 * reach the network outside CSP. `<link>` (hints such as prerender, which
 * Chromium fetches whatever the CSP says) and nested browsing contexts
 * (iframe, frame, object, embed, portal, fencedframe) become inert unknown
 * elements wherever the text appears, quoted in a script included, and
 * speculation rules lose their type. Remote stylesheets, fonts and frames
 * are blocked by CSP anyway, so nothing a page may do is lost. Pure. */
export function neuterPageHtml(html: string): string {
  return html
    .replace(/<(\/?)(link|iframe|frame|frameset|object|embed|portal|fencedframe)(?=[\s/>]|$)/gi, "<$1sagax-removed-$2")
    .replace(/speculationrules/gi, "speculationrules-removed");
}

/** Run first in every HTML page, synchronously, best effort: what CSP does
 * not stop everywhere. WebRTC constructors are made undefined; every way a
 * script inserts or changes an element is patched so that a `<link>` with a
 * resource-hint rel (dns-prefetch, preconnect, prefetch, prerender, preload,
 * modulepreload, next) or a speculation-rules script is neutered BEFORE it
 * is in the document, and nested frames cannot be created (no fresh realm
 * with unpatched prototypes). The patched descriptors are non-configurable
 * and non-writable. Same string rules as neuterPageHtml for HTML strings. */
const PRELUDE_SOURCE = String.raw`(function(){"use strict";
var W=window,D=document,O=Object;
function lock(o,n,d){try{d.configurable=false;O.defineProperty(o,n,d)}catch(e){}}
["RTCPeerConnection","webkitRTCPeerConnection","mozRTCPeerConnection","RTCDataChannel","RTCRtpSender","RTCRtpReceiver","RTCRtpTransceiver","RTCIceCandidate","RTCSessionDescription","RTCDtlsTransport","RTCIceTransport","RTCSctpTransport","RTCCertificate","RTCEncodedAudioFrame","RTCEncodedVideoFrame"].forEach(function(n){lock(W,n,{value:undefined,writable:false,enumerable:false})});
var BAD=/(^|\s)(dns-prefetch|preconnect|prefetch|prerender|preload|modulepreload|next)(?=\s|$)/i,SR=/speculationrules/i,FR=/^(iframe|frame|frameset|object|embed|portal|fencedframe)$/i;
var EP=Element.prototype,NP=Node.prototype,FP=DocumentFragment.prototype,DP=Document.prototype;
var getA=EP.getAttribute,setA=EP.setAttribute,remA=EP.removeAttribute,qsa=EP.querySelectorAll,fqsa=FP.querySelectorAll;
function san(s){return String(s).replace(/<(\/?)(link|iframe|frame|frameset|object|embed|portal|fencedframe)(?=[\s/>]|$)/gi,"<$1sagax-removed-$2").replace(/speculationrules/gi,"speculationrules-removed")}
function neuter(el){if(!el||el.nodeType!==1)return;var t=el.localName;if(t==="link"){var r=getA.call(el,"rel");if(r&&BAD.test(r)){remA.call(el,"rel");remA.call(el,"href")}}else if(t==="script"){var y=getA.call(el,"type");if(y&&SR.test(y))setA.call(el,"type","text/plain")}}
function clean(n){if(!n||typeof n!=="object")return n;var l,i;if(n.nodeType===1){neuter(n);l=qsa.call(n,"link,script");for(i=0;i<l.length;i++)neuter(l[i])}else if(n.nodeType===11){l=fqsa.call(n,"link,script");for(i=0;i<l.length;i++)neuter(l[i])}return n}
function wrap(p,name,before,after){var f=p&&p[name];if(typeof f!=="function")return;lock(p,name,{value:function(){var a=Array.prototype.slice.call(arguments);if(before)before(a,this);var out=f.apply(this,a);if(after)after(a,this,out);return out},writable:false,enumerable:false})}
function setter(p,prop,fix,after){var d=p&&O.getOwnPropertyDescriptor(p,prop);if(!d||!d.set)return;var set=d.set;lock(p,prop,{get:d.get,set:function(v){set.call(this,fix?fix(this,v):v);if(after)after(this)},enumerable:d.enumerable})}
var each=function(a){for(var i=0;i<a.length;i++)clean(a[i])};
wrap(NP,"appendChild",each);wrap(NP,"insertBefore",function(a){clean(a[0])});wrap(NP,"replaceChild",function(a){clean(a[0])});
["append","prepend","after","before","replaceWith","replaceChildren"].forEach(function(n){wrap(EP,n,each);wrap(FP,n,each);wrap(DP,n,each);wrap(W.CharacterData&&CharacterData.prototype,n,each);wrap(W.DocumentType&&DocumentType.prototype,n,each)});
wrap(EP,"insertAdjacentElement",function(a){clean(a[1])});
wrap(EP,"insertAdjacentHTML",function(a){a[1]=san(a[1])});
wrap(EP,"setHTMLUnsafe",function(a){a[0]=san(a[0])});wrap(EP,"setHTML",function(a){a[0]=san(a[0])});
wrap(W.ShadowRoot&&ShadowRoot.prototype,"setHTMLUnsafe",function(a){a[0]=san(a[0])});
wrap(W.Range&&Range.prototype,"createContextualFragment",function(a){a[0]=san(a[0])});
wrap(W.Range&&Range.prototype,"insertNode",function(a){clean(a[0])});
wrap(DP,"write",function(a){for(var i=0;i<a.length;i++)a[i]=san(a[i])});
wrap(DP,"writeln",function(a){for(var i=0;i<a.length;i++)a[i]=san(a[i])});
wrap(W.DOMParser&&DOMParser.prototype,"parseFromString",function(a){a[0]=san(a[0])});
if(W.Document&&Document.parseHTMLUnsafe){var ph=Document.parseHTMLUnsafe;lock(Document,"parseHTMLUnsafe",{value:function(s){return ph.call(this,san(s))},writable:false})}
[DP,O.getPrototypeOf(D)].forEach(function(p,i,all){if(i&&p===all[0])return;
wrap(p,"createElement",function(a){if(FR.test(String(a[0])))a[0]="sagax-removed-"+String(a[0])});
wrap(p,"createElementNS",function(a){var q=String(a[1]);if(FR.test(q.split(":").pop()))a[1]="sagax-removed-"+q.replace(":","-")})});
wrap(EP,"setAttribute",function(a,el){var n=String(a[0]).toLowerCase();if(n==="rel"&&el.localName==="link"&&BAD.test(String(a[1])))a[1]="";if(n==="type"&&el.localName==="script"&&SR.test(String(a[1])))a[1]="text/plain";if(n==="srcdoc")a[0]="data-removed-srcdoc"});
wrap(EP,"setAttributeNS",function(a,el){var n=String(a[1]).toLowerCase().split(":").pop();if(n==="rel"&&el.localName==="link"&&BAD.test(String(a[2])))a[2]="";if(n==="type"&&el.localName==="script"&&SR.test(String(a[2])))a[2]="text/plain";if(n==="srcdoc")a[1]="data-removed-srcdoc"});
wrap(EP,"setAttributeNode",null,function(a,el){neuter(el)});wrap(EP,"setAttributeNodeNS",null,function(a,el){neuter(el)});
wrap(EP,"toggleAttribute",null,function(a,el){neuter(el)});
wrap(W.NamedNodeMap&&NamedNodeMap.prototype,"setNamedItem",null,function(a){neuter(a[0]&&a[0].ownerElement)});
wrap(W.NamedNodeMap&&NamedNodeMap.prototype,"setNamedItemNS",null,function(a){neuter(a[0]&&a[0].ownerElement)});
setter(W.Attr&&Attr.prototype,"value",null,function(at){neuter(at.ownerElement)});
setter(NP,"nodeValue",null,function(at){if(at.nodeType===2)neuter(at.ownerElement)});
setter(NP,"textContent",null,function(at){if(at.nodeType===2)neuter(at.ownerElement)});
setter(W.HTMLLinkElement&&HTMLLinkElement.prototype,"rel",function(el,v){return BAD.test(String(v))?"":v});
setter(W.HTMLScriptElement&&HTMLScriptElement.prototype,"type",function(el,v){return SR.test(String(v))?"text/plain":v});
setter(W.HTMLIFrameElement&&HTMLIFrameElement.prototype,"srcdoc",function(){return ""});
var tl=W.DOMTokenList&&DOMTokenList.prototype,tremove=tl&&tl.remove;
function scrub(a,list){var v=String(list.value);if(BAD.test(v)){var bad=v.split(/\s+/).filter(function(t){return BAD.test(t)});tremove.apply(list,bad)}}
["add","toggle","replace"].forEach(function(n){wrap(tl,n,null,scrub)});
setter(tl,"value",null,function(list){scrub(null,list)});
setter(EP,"innerHTML",function(el,v){return san(v)});setter(EP,"outerHTML",function(el,v){return san(v)});
setter(W.ShadowRoot&&ShadowRoot.prototype,"innerHTML",function(el,v){return san(v)});
setter(W.HTMLIFrameElement&&HTMLIFrameElement.prototype,"src",function(){return "about:blank"});
})();`;

export const FRAME_PRELUDE = `<meta http-equiv="x-dns-prefetch-control" content="off"><script>${PRELUDE_SOURCE}</script>`;

/** The annotation mode of the app's preview (Grok Bot's « Annoter la page »;
 * the page's person only, never a reader's link). A click on any element is
 * caught before the page sees it: the element gets a numbered badge and its
 * tag, a short piece of its text and a CSS-like path are posted to the app's
 * window (window.top: the preview wrapper is framed by the app only). The
 * app checks the sender is this frame and shows the list; nothing is sent to
 * a bot until the person presses Send. No network: it only posts a message.
 * The page's own scripts could post the same message; the app treats every
 * field as plain text and caps it (parseAnnotationMessage). */
export const ANNOTATE_SOURCE = String.raw`(function(){"use strict";
var n=0,D=document,hover=null;
var st=D.createElement("style");st.textContent="[data-sagax-hover]{outline:2px dashed #2f6feb!important;outline-offset:2px!important;cursor:crosshair!important}[data-sagax-note]{outline:2px solid #2f6feb!important;outline-offset:2px!important}.sagax-note-badge{position:absolute;z-index:2147483647;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#2f6feb;color:#fff;font:600 12px/20px system-ui,sans-serif;text-align:center;pointer-events:none;box-shadow:0 1px 3px rgba(0,0,0,.35)}";
(D.head||D.documentElement).appendChild(st);
function line(s,m){s=String(s||"").replace(/\s+/g," ").trim();return s.length>m?s.slice(0,m-1)+"…":s}
function path(el){var p=[],e=el;while(e&&e.nodeType===1&&p.length<6){var t=e.localName,i=1,s=e;while((s=s.previousElementSibling))if(s.localName===t)i++;p.unshift(i>1?t+":nth-of-type("+i+")":t);if(t==="body")break;e=e.parentElement}return p.join(" > ")}
function badge(el,k){var r=el.getBoundingClientRect(),b=D.createElement("div");b.className="sagax-note-badge";b.textContent=String(k);b.style.left=Math.max(0,r.left+window.scrollX-8)+"px";b.style.top=Math.max(0,r.top+window.scrollY-8)+"px";D.body.appendChild(b)}
D.addEventListener("mouseover",function(e){var el=e.target;if(!el||el.nodeType!==1||el===D.body||el===D.documentElement)return;if(hover)hover.removeAttribute("data-sagax-hover");hover=el;el.setAttribute("data-sagax-hover","")},true);
D.addEventListener("click",function(e){var el=e.target;if(!el||el.nodeType!==1)return;e.preventDefault();e.stopPropagation();if(e.stopImmediatePropagation)e.stopImmediatePropagation();if(el.className==="sagax-note-badge")return;n+=1;el.setAttribute("data-sagax-note",String(n));badge(el,n);
window.top.postMessage({type:"${PAGE_ANNOTATION_MESSAGE}",v:1,n:n,tag:el.localName,text:line(el.innerText||el.textContent,160),path:line(path(el),240)},"*")},true);
["submit","auxclick","dblclick"].forEach(function(k){D.addEventListener(k,function(e){e.preventDefault();e.stopPropagation()},true)});
})();`;

/** Slides of a presentation: Markdown separated by a line of three dashes
 * or more; empty slides at the end are dropped. Pure. */
export function splitSlides(markdown: string): string[] {
  const slides = markdown.replace(/\r\n?/g, "\n").split(/\n[ \t]*-{3,}[ \t]*(?:\n|$)/).map((slide) => slide.trim());
  while (slides.length > 1 && !slides.at(-1)) slides.pop();
  return slides;
}

/** A presentation's body: one full-height section per slide, its number,
 * and Previous / Next as in-page anchors (fragment navigation needs no
 * script). The slides are our own escaped Markdown. Pure. */
export function presentationToHtml(markdown: string): string {
  const slides = splitSlides(markdown);
  const total = slides.length;
  return slides.map((slide, index) => {
    const n = index + 1;
    const previous = n > 1 ? `<a class="nav prev" href="#slide-${n - 1}" aria-label="Previous">\u2039</a>` : "";
    const next = n < total ? `<a class="nav next" href="#slide-${n + 1}" aria-label="Next">\u203a</a>` : "";
    return `<section class="slide" id="slide-${n}"><div class="content">${markdownToHtml(slide)}</div>`
      + `<footer>${previous}<span class="count">${n} / ${total}</span>${next}</footer></section>`;
  }).join("\n");
}

const PRESENTATION_STYLE = "html{scroll-snap-type:y mandatory;scroll-behavior:smooth}body{margin:0;font:clamp(16px,2.4vw,30px)/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#1f2328;background:#fff}"
  + ".slide{position:relative;box-sizing:border-box;height:100vh;scroll-snap-align:start;display:flex;flex-direction:column;justify-content:center;padding:6vh 8vw;border-bottom:1px solid #eaeef2;overflow:hidden}"
  + ".slide h1{font-size:2.2em;line-height:1.15;margin:0 0 .4em}.slide h2{font-size:1.6em;margin:0 0 .4em}.slide ul,.slide ol{margin:.3em 0}"
  + "pre{background:#f6f8fa;padding:.6em;border-radius:6px;overflow:auto;font-size:.7em}code{font:.9em ui-monospace,Menlo,monospace}"
  + "blockquote{margin:0;padding-left:1rem;border-left:3px solid #d0d7de;color:#57606a}.url{color:#57606a;word-break:break-all}"
  + "footer{position:absolute;right:3vw;bottom:2.5vh;display:flex;align-items:center;gap:.6em;font-size:14px;color:#57606a}"
  + ".nav{display:inline-block;min-width:32px;height:32px;border-radius:16px;text-align:center;line-height:30px;font-size:22px;text-decoration:none;color:inherit;border:1px solid #d0d7de}"
  + "@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}.slide{border-color:#21262d}pre{background:#161b22}.url,footer{color:#9198a1}.nav{border-color:#30363d}}";

/** A name for the banner: one line, at most PAGE_BANNER_NAME_MAX characters. Pure. */
export function bannerName(name: string): string {
  const line = name.replace(/\s+/g, " ").trim();
  return line.length <= PAGE_BANNER_NAME_MAX ? line : `${line.slice(0, PAGE_BANNER_NAME_MAX - 1).trimEnd()}…`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHref(raw: string): string | null {
  const href = raw.trim();
  return /^(https?:\/\/|mailto:)[^\s<>"']+$/i.test(href) ? href : null;
}

/** Inline Markdown on an already escaped line: code, bold, italic, links. */
function inline(escaped: string): string {
  const codes: string[] = [];
  let out = escaped.replace(/`([^`]+)`/g, (_match, code: string) => {
    codes.push(`<code>${code}</code>`);
    return `\uE000${codes.length - 1}\uE001`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    // The href is escaped text: &amp; is the only entity a URL keeps.
    const url = safeHref(href.replace(/&amp;/g, "&"));
    return url ? `${label} (<span class="url">${escapeHtml(url)}</span>)` : match;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return out.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => codes[Number(index)] ?? "");
}

/** Markdown to an HTML body fragment. Pure. */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  const flushParagraph = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map((line) => inline(escapeHtml(line))).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((item) => `<li>${inline(escapeHtml(item))}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith("```")) body.push(lines[index++]!);
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(escapeHtml(heading[2]!.trim()))}</h${level}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushParagraph();
      flushList();
      out.push("<hr>");
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      out.push(`<blockquote>${inline(escapeHtml(quote[1]!))}</blockquote>`);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return out.join("\n");
}

const MARKDOWN_STYLE = "body{font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1f2328;background:#fff}"
  + "pre{background:#f6f8fa;padding:.75rem;border-radius:6px;overflow:auto}code{font:.9em ui-monospace,Menlo,monospace}"
  + "blockquote{margin:0;padding-left:1rem;border-left:3px solid #d0d7de;color:#57606a}.url{color:#57606a;word-break:break-all}"
  + "@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}pre{background:#161b22}.url{color:#9198a1}}";

/** The full document a version is read as. `meta` adds the CSP as a meta tag
 * (the app's sandboxed preview, which has no response headers). Pure. */
export function pageDocument(input: { kind: PageKind; title: string; content: string; lang?: string }, options: { meta?: boolean; annotateNonce?: string } = {}): string {
  const meta = options.meta ? `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(pageCsp(input.kind, { meta: true }))}">` : "";
  // The annotation script (the app's preview only): by its nonce on a page
  // that otherwise runs no script, inline after the prelude on an HTML page.
  const annotate = options.annotateNonce === undefined ? ""
    : input.kind === "html" ? `<script>${ANNOTATE_SOURCE}</script>` : `<script nonce="${escapeHtml(options.annotateNonce)}">${ANNOTATE_SOURCE}</script>`;
  if (input.kind === "markdown" || input.kind === "presentation") {
    const presentation = input.kind === "presentation";
    return `<!doctype html><html lang="${escapeHtml(input.lang ?? "fr")}"><head><meta charset="utf-8">${meta}`
      + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)}</title>`
      + `<style>${presentation ? PRESENTATION_STYLE : MARKDOWN_STYLE}</style></head>`
      + `<body>${presentation ? presentationToHtml(input.content) : markdownToHtml(input.content)}${annotate}</body></html>`;
  }
  const head = `${meta}${FRAME_PRELUDE}`;
  const content = neuterPageHtml(input.content);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(content);
  const page = doctype
    ? `${doctype[0]}${head}${content.slice(doctype[0].length)}`
    : `${head}${content}`;
  return `${page}${annotate}`;
}

export interface WrapperInput {
  title: string;
  kind: PageKind;
  botName: string;
  personName: string;
  /** Where the frame loads the page: the frame path plus its ticket, on this
   * origin or the separate pages origin. */
  frameUrl: string;
  lang: "fr" | "en";
  /** The app's preview of a version not yet (or no longer) published. */
  preview?: boolean;
  /** The preview's annotation mode: the frame runs the annotation script. */
  annotate?: boolean;
  /** Reader comments (a reading link with them on): the approved ones and
   * the form's action. A plain form, no script; the wrapper's CSP pins
   * form-action to that path. */
  comments?: { action: string; approved: ReaderComment[] };
}

/** The banner's words. Pure. */
export function wrapperBanner(input: Pick<WrapperInput, "botName" | "personName" | "lang" | "preview">): string {
  const bot = bannerName(input.botName);
  const person = bannerName(input.personName);
  if (input.preview) {
    return input.lang === "fr"
      ? `Aperçu d'une page proposée par ${bot} pour ${person} : ceci n'est pas un écran Sagax, n'y entrez jamais de mot de passe.`
      : `Preview of a page proposed by ${bot} for ${person}: this is not a Sagax screen, never enter a password here.`;
  }
  return input.lang === "fr"
    ? `Page publiée par ${bot} pour ${person} : ceci n'est pas un écran Sagax, n'y entrez jamais de mot de passe.`
    : `Page published by ${bot} for ${person}: this is not a Sagax screen, never enter a password here.`;
}

/** The reader's document: banner, then the page in its sandboxed frame. No
 * script of its own. Pure. */
export function wrapperDocument(input: WrapperInput): string {
  const sandbox = pageFrameSandbox(input.kind, { annotate: input.annotate === true });
  return `<!doctype html><html lang="${input.lang}"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)}</title>`
    + "<style>html,body{margin:0;height:100%}body{display:flex;flex-direction:column;font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}"
    + ".sagax-banner{flex:none;padding:8px 14px;background:#fff4ce;color:#3d2e00;border-bottom:2px solid #d4a600;font-weight:600}"
    + "iframe{flex:1;border:0;width:100%;background:#fff}"
    + (input.comments ? COMMENTS_STYLE : "")
    + "</style></head><body>"
    + `<div class="sagax-banner" role="note">${escapeHtml(wrapperBanner(input))}</div>`
    + `<iframe src="${escapeHtml(input.frameUrl)}" sandbox="${sandbox}" referrerpolicy="no-referrer" allow="" title="${escapeHtml(input.title)}"></iframe>`
    + (input.comments ? commentsSection(input.comments, input.lang, input.personName) : "")
    + "</body></html>";
}

const COMMENTS_STYLE = ".sagax-comments{flex:none;max-height:40vh;overflow:auto;border-top:1px solid #d0d7de;padding:8px 14px;background:#f6f8fa;color:#1f2328}"
  + ".sagax-comments summary{cursor:pointer;font-weight:600}.sagax-comments li{margin:6px 0}.sagax-comments .who{font-weight:600}"
  + ".sagax-comments form{display:flex;flex-direction:column;gap:6px;max-width:40rem;margin-top:8px}"
  + ".sagax-comments input,.sagax-comments textarea{font:inherit;padding:4px 6px;border:1px solid #d0d7de;border-radius:6px}"
  + ".sagax-comments .trap{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}"
  + ".sagax-comments button{align-self:flex-start;font:inherit;padding:4px 12px;border-radius:6px;border:1px solid #1f6feb;background:#1f6feb;color:#fff}"
  + "@media (prefers-color-scheme:dark){.sagax-comments{background:#161b22;color:#e6edf3;border-color:#30363d}.sagax-comments input,.sagax-comments textarea{background:#0d1117;color:#e6edf3;border-color:#30363d}}";

/** The comments under a shared page: the approved ones (escaped text), then
 * a plain form. A hidden "website" field is the honeypot. Pure. */
function commentsSection(comments: { action: string; approved: ReaderComment[] }, lang: "fr" | "en", personName: string): string {
  const fr = lang === "fr";
  const items = comments.approved.map((entry) => `<li><span class="who">${escapeHtml(entry.name)}</span> : ${escapeHtml(entry.text)}</li>`).join("");
  return `<details class="sagax-comments"${comments.approved.length ? " open" : ""}><summary>${fr ? "Commentaires" : "Comments"} (${comments.approved.length})</summary>`
    + (items ? `<ul>${items}</ul>` : "")
    + `<form method="post" action="${escapeHtml(comments.action)}">`
    + `<label>${fr ? "Votre nom" : "Your name"} <input name="name" required maxlength="${PAGE_LIMITS.readerNameChars}" autocomplete="name"></label>`
    + `<label>${fr ? "Commentaire" : "Comment"} <textarea name="text" required rows="3" maxlength="${PAGE_LIMITS.readerCommentChars}"></textarea></label>`
    + `<label class="trap" aria-hidden="true">Website <input name="website" tabindex="-1" autocomplete="off"></label>`
    + `<small>${escapeHtml(fr ? `Votre commentaire sera visible après l'approbation de ${bannerName(personName)}. N'y mettez aucun renseignement personnel ni mot de passe.` : `Your comment shows once ${bannerName(personName)} approves it. Never put personal information or a password in it.`)}</small>`
    + `<button type="submit">${fr ? "Envoyer" : "Send"}</button></form></details>`;
}

/** The answer to a reader's comment: a plain page, no script, a link back. Pure. */
export function commentAnswerDocument(input: { lang: "fr" | "en"; back: string; ok: boolean; message?: string }): string {
  const fr = input.lang === "fr";
  const text = input.message ?? (input.ok
    ? (fr ? "Merci. Votre commentaire attend l'approbation de la personne qui a publié la page." : "Thank you. Your comment waits for the approval of the person who published the page.")
    : (fr ? "Ce commentaire n'a pas pu être envoyé." : "This comment could not be sent."));
  return `<!doctype html><html lang="${input.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${fr ? "Commentaire" : "Comment"}</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem}</style></head>`
    + `<body><p>${escapeHtml(text)}</p><p><a href="${escapeHtml(input.back)}">${fr ? "Revenir à la page" : "Back to the page"}</a></p></body></html>`;
}
