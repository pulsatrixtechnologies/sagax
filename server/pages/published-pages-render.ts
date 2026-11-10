// The bytes a published page is read as (shared/published-pages.ts has the
// isolation rules). An HTML page is the bot's document as written: it runs
// in an opaque-origin sandbox under a CSP with no network, so its scripts
// can only touch their own document. A Markdown page is turned into HTML
// here by a small renderer that escapes every character first and emits
// only a fixed set of tags (no raw HTML, links http(s) and mailto only).
// Markdown runs only our nonce'd scripts. External http(s)/mailto links
// post to the wrapper (PAGE_OPEN_MESSAGE); the wrapper opens the system
// browser. Never allow-popups (#1799).
//
// The reader never lands on the page itself: wrapperDocument is a Sagax page
// with a permanent banner that embeds the page in a frame sandboxed to
// scripts only, whose navigation the wrapper's `frame-src` limits to the
// page's own frame path.
import { pageThemeStyle } from "../../src/lib/page-theme.ts";
import type { WidgetThemeTokens } from "../../src/lib/widget-kit.ts";
import { READER_ACTIONS_ID, READER_BOOT_ID, READER_MASCOT_ID, readerByline, type ReaderBoot } from "../../shared/page-reader.ts";
import { readerBarThemeCss, type PageLook } from "../../src/lib/page-look.ts";
import { STATE_ASK_MESSAGE, STATE_MESSAGE, STATE_RESULT_MESSAGE, STATE_SET_MESSAGE } from "../../shared/page-state.ts";
import { CAP_EVENT_MESSAGE, CAP_HELLO_MESSAGE, CAP_MESSAGE, CAP_READY_MESSAGE, CAP_READY_TIMEOUT_MS, CAP_RESULT_MESSAGE, pageCapabilitiesAny, type PageCapabilities } from "../../shared/page-capabilities.ts";
import { ANNOTATE_FOCUS_MESSAGE, ANNOTATE_FOUND_MESSAGE, ANNOTATE_MARKS_MESSAGE, ANNOTATE_MODE_MESSAGE, ANNOTATE_SELECT_MESSAGE, THREAD_LIMITS } from "../../shared/page-threads.ts";
import { PAGE_ANNOTATION_MESSAGE, PAGE_BANNER_NAME_MAX, PAGE_HEIGHT_MAX, PAGE_LIMITS, PAGE_OPEN_MESSAGE, PAGE_SCROLL_MAX, PAGE_SCROLL_MESSAGE, PAGE_SIZE_ASK, PAGE_SIZE_MESSAGE, pageCsp, pageFrameSandbox, pageIsHtml, type PageKind, type PageTheme, type ReaderComment } from "../../shared/published-pages.ts";

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

/** The annotation mode of the app's preview (the reference design's « Annoter la page »;
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

/** The app's own preview keeps its place (2026-10-28): after the page
 * loads it scrolls to `y` (the place the app last heard), and while the
 * person scrolls it posts how far down it is to the app's window
 * (window.top: the preview wrapper is framed by the app only). No network,
 * only a number. `y` is a whole number the server checked. Pure. */
export function keepScrollSource(y: number): string {
  const start = Number.isSafeInteger(y) && y > 0 && y <= PAGE_SCROLL_MAX ? y : 0;
  return `(function(){"use strict";var y=${start},t=0;`
    + "function go(){if(y>0)window.scrollTo(0,y)}"
    + "if(document.readyState===\"complete\")go();else window.addEventListener(\"load\",go);"
    + `window.addEventListener("scroll",function(){clearTimeout(t);t=setTimeout(function(){try{window.top.postMessage({type:"${PAGE_SCROLL_MESSAGE}",v:1,y:Math.max(0,Math.round(window.scrollY))},"*")}catch(e){}},120)},{passive:true});`
    + "})();";
}

/** A reading frame tells its wrapper how tall the page is (2026-10-28,
 * Download PDF): the whole height and the window's, posted to the parent
 * (the wrapper) on load and whenever it changes. The wrapper may ask again (PAGE_SIZE_ASK) when its script
 * starts after the page loaded. No network, only two numbers. */
export const REPORT_SIZE_SOURCE = String.raw`(function(){"use strict";var last="",t=0,D=document;`
  + "function send(){if(window.matchMedia&&window.matchMedia(\"print\").matches)return;var d=D.documentElement,b=D.body,vh=Math.round(window.innerHeight)||1;"
  + `var h=Math.min(${PAGE_HEIGHT_MAX},Math.max(1,Math.round(Math.max(d.scrollHeight,b?b.scrollHeight:0))));`
  + `var key=h+":"+vh;if(key===last)return;last=key;`
  + `try{window.parent.postMessage({type:"${PAGE_SIZE_MESSAGE}",v:1,h:h,vh:Math.min(${PAGE_HEIGHT_MAX},vh)},"*")}catch(e){}}`
  + "function soon(){clearTimeout(t);t=setTimeout(send,100)}"
  + "if(D.readyState===\"complete\")send();else window.addEventListener(\"load\",send);"
  + "window.addEventListener(\"resize\",soon);"
  + `window.addEventListener("message",function(e){if(e.source===window.parent&&e.data&&e.data.type==="${PAGE_SIZE_ASK}"){last="";send()}});`
  + "if(window.ResizeObserver){try{var o=new ResizeObserver(soon);o.observe(D.documentElement);if(D.body)o.observe(D.body)}catch(e){}}"
  + "})();";

/** Catch <a href> clicks and window.open inside the sandboxed page; post an
 * absolute http(s)/mailto URL to the parent. Never allow-popups (#1799).
 * Hash links (#slide-n) stay in the frame. */
export const OPEN_BRIDGE_SOURCE = String.raw`(function(){"use strict";
function ok(u){if(typeof u!=="string"||!u||u.charAt(0)==="#")return null;try{var x=new URL(u);if(x.username||x.password)return null;if(x.protocol==="https:"||x.protocol==="http:")return x.hostname?x.href:null;if(x.protocol==="mailto:")return x.href}catch(e){}return null}
function ask(u){var href=ok(u);if(!href)return false;try{parent.postMessage({type:"${PAGE_OPEN_MESSAGE}",url:href},"*")}catch(e){}try{if(window.top&&window.top!==window)window.top.postMessage({type:"${PAGE_OPEN_MESSAGE}",url:href},"*")}catch(e){}return true}
addEventListener("click",function(e){var t=e.target;while(t&&t.nodeType===1&&String(t.localName).toLowerCase()!=="a")t=t.parentElement;if(!t||String(t.localName).toLowerCase()!=="a")return;if(ask(t.getAttribute("href"))){e.preventDefault();e.stopPropagation()}},true);
try{window.open=function(u){ask(typeof u==="string"?u:"");return null}}catch(e){}
})();`;

/** The wrapper opens a validated URL the page frame posted (system browser
 * via window.open; Electron's setWindowOpenHandler routes it out). */
export const WRAPPER_OPEN_SOURCE = String.raw`(function(){"use strict";
addEventListener("message",function(e){var f=document.querySelector("iframe");if(!f||e.source!==f.contentWindow)return;var d=e.data;if(!d||d.type!=="${PAGE_OPEN_MESSAGE}"||typeof d.url!=="string")return;try{var u=new URL(d.url);if(u.username||u.password)return;if(u.protocol!=="https:"&&u.protocol!=="http:"&&u.protocol!=="mailto:")return;if((u.protocol==="https:"||u.protocol==="http:")&&!u.hostname)return;window.open(u.href,"_blank","noopener,noreferrer")}catch(x){}});
})();`;

/** A reading frame's side of Annotate (2026-10-28, shared/page-threads.ts):
 * dormant until the wrapper (its parent, never the page) turns annotation
 * mode on. Then a text selection, or a click on a part of the page, is
 * posted to the wrapper as an anchor (the page's own words, a little before
 * and after, a CSS-like path). The wrapper sends back the anchors to
 * highlight (ids and the page's own words, never a comment or a name); the
 * frame draws them (CSS highlights, an outline on a part), tells the wrapper
 * which it found in page order, and posts the id of a highlight the reader
 * clicks. No network: messages to the parent only. */
export const ANNOTATE_BRIDGE_SOURCE = String.raw`(function(){"use strict";
var D=document,W=window,on=false,marks=[],hits=[],hover=null;
var HL=!!(W.CSS&&W.CSS.highlights&&W.Highlight),H=HL?W.CSS.highlights:null;
var st=D.createElement("style");
st.textContent="::highlight(sagax-note){background-color:rgba(255,196,0,.38)}::highlight(sagax-note-active){background-color:rgba(255,150,0,.62)}::highlight(sagax-note-done){background-color:rgba(150,150,150,.2)}"
+"[data-sagax-mark]{outline:2px solid rgba(255,170,0,.85)!important;outline-offset:2px!important}[data-sagax-mark=active]{outline:3px solid #f59e0b!important}[data-sagax-mark=done]{outline:1px dashed rgba(150,150,150,.7)!important}"
+"html.sagax-annotating [data-sagax-hover]{outline:2px dashed #2f6feb!important;outline-offset:2px!important;cursor:crosshair!important}";
(D.head||D.documentElement).appendChild(st);
function post(m){try{W.parent.postMessage(m,"*")}catch(e){}}
function path(el){var p=[],e=el;while(e&&e.nodeType===1&&p.length<8){var t=e.localName,i=1,s=e;if(t==="body"){p.unshift("body");break}while((s=s.previousElementSibling))if(s.localName===t)i++;p.unshift(i>1?t+":nth-of-type("+i+")":t);e=e.parentElement}return p.join(" > ")}
function texts(){var b=D.body,out=[],pos=0;if(!b)return{list:out,text:""};var w=D.createTreeWalker(b,4,null),n;while((n=w.nextNode())){out.push({n:n,s:pos});pos+=n.data.length}return{list:out,text:out.map(function(x){return x.n.data}).join("")}}
function at(node,off){var r=D.createRange();r.setStart(D.body,0);try{r.setEnd(node,off)}catch(e){return -1}return r.toString().length}
function locate(t,pos,end){var l=t.list;for(var i=0;i<l.length;i++){var e=l[i],n=e.n.data.length;if(pos>=e.s&&(pos<e.s+n||(end&&pos===e.s+n)))return{n:e.n,o:pos-e.s}}var last=l[l.length-1];return last?{n:last.n,o:last.n.data.length}:null}
function selected(){var sel=W.getSelection();if(!sel||sel.isCollapsed||!sel.rangeCount||!D.body)return null;var r=sel.getRangeAt(0);if(!D.body.contains(r.commonAncestorContainer))return null;
var t=texts(),a=at(r.startContainer,r.startOffset),b=at(r.endContainer,r.endOffset);if(a<0||b<=a)return null;b=Math.min(b,a+${THREAD_LIMITS.quoteChars});var q=t.text.slice(a,b);if(!q.trim())return null;
var el=r.commonAncestorContainer;if(el.nodeType!==1)el=el.parentElement;if(!el)return null;
return{kind:"text",quote:q,prefix:t.text.slice(Math.max(0,a-${THREAD_LIMITS.contextChars}),a),suffix:t.text.slice(b,b+${THREAD_LIMITS.contextChars}),path:path(el),tag:el.localName}}
function element(el){var s=String(el.innerText||el.textContent||"").replace(/\s+/g," ").trim();return{kind:"element",quote:s.slice(0,160),prefix:"",suffix:"",path:path(el),tag:el.localName}}
function tail(a,b){var n=Math.min(a.length,b.length,24);return n>0&&a.slice(a.length-n)===b.slice(b.length-n)}
function head(a,b){var n=Math.min(a.length,b.length,24);return n>0&&a.slice(0,n)===b.slice(0,n)}
function find(a,t){if(!a)return null;if(a.kind==="element"){var el=null;try{el=D.querySelector(a.path)}catch(e){}return el&&el.localName===a.tag?{el:el}:null}
var q=a.quote,txt=t.text,best=-1,score=-1,i=txt.indexOf(q);while(i>=0){var s=0;if(a.prefix&&tail(txt.slice(Math.max(0,i-a.prefix.length),i),a.prefix))s+=1;if(a.suffix&&head(txt.slice(i+q.length,i+q.length+a.suffix.length),a.suffix))s+=1;if(s>score){score=s;best=i}if(score>=2)break;i=txt.indexOf(q,i+1)}
if(best<0)return null;var x=locate(t,best,false),y=locate(t,best+q.length,true);if(!x||!y)return null;var r=D.createRange();try{r.setStart(x.n,x.o);r.setEnd(y.n,y.o)}catch(e){return null}return{range:r}}
function clear(){if(H){H.delete("sagax-note");H.delete("sagax-note-active");H.delete("sagax-note-done")}var l=D.querySelectorAll("[data-sagax-mark]");for(var i=0;i<l.length;i++)l[i].removeAttribute("data-sagax-mark")}
function draw(scroll){clear();hits=[];var t=texts(),open=[],act=[],done=[],found=[];
marks.forEach(function(m){var f=find(m.anchor,t);if(!f)return;var box;if(f.range){(m.active?act:m.resolved?done:open).push(f.range);box=f.range.getBoundingClientRect()}else{f.el.setAttribute("data-sagax-mark",m.active?"active":m.resolved?"done":"open");box=f.el.getBoundingClientRect()}
found.push({id:m.id,top:box.top+W.scrollY,left:box.left,r:f.range||f.el});if(scroll&&m.id===scroll)W.scrollTo({top:Math.max(0,box.top+W.scrollY-120),behavior:"smooth"})});
if(H){if(open.length)H.set("sagax-note",new W.Highlight(...open));if(done.length)H.set("sagax-note-done",new W.Highlight(...done));if(act.length)H.set("sagax-note-active",new W.Highlight(...act))}
found.sort(function(a,b){return a.top-b.top||a.left-b.left});hits=found;post({type:"${ANNOTATE_FOUND_MESSAGE}",v:1,ids:found.map(function(f){return f.id})})}
function caret(x,y){if(D.caretPositionFromPoint){var c=D.caretPositionFromPoint(x,y);return c?{n:c.offsetNode,o:c.offset}:null}if(D.caretRangeFromPoint){var r=D.caretRangeFromPoint(x,y);return r?{n:r.startContainer,o:r.startOffset}:null}return null}
function hitAt(e){var c=null;for(var i=0;i<hits.length;i++){var h=hits[i];if(h.r.nodeType===1){if(h.r.contains(e.target))return h.id}else{c=c||caret(e.clientX,e.clientY);try{if(c&&h.r.isPointInRange(c.n,c.o))return h.id}catch(x){}}}return null}
W.addEventListener("message",function(e){if(e.source!==W.parent||!e.data||e.data.v!==1)return;var d=e.data;
if(d.type==="${ANNOTATE_MODE_MESSAGE}"){on=d.on===true;D.documentElement.classList.toggle("sagax-annotating",on);if(!on&&hover){hover.removeAttribute("data-sagax-hover");hover=null}}
else if(d.type==="${ANNOTATE_MARKS_MESSAGE}"&&Array.isArray(d.marks)){marks=d.marks.slice(0,${THREAD_LIMITS.threads}).filter(function(m){return m&&typeof m.id==="string"&&m.anchor&&typeof m.anchor.quote==="string"});draw(typeof d.scroll==="string"?d.scroll:null)}});
D.addEventListener("mouseover",function(e){if(!on)return;var el=e.target;if(!el||el.nodeType!==1||el===D.body||el===D.documentElement)return;if(hover)hover.removeAttribute("data-sagax-hover");hover=el;el.setAttribute("data-sagax-hover","")},true);
D.addEventListener("mouseup",function(){if(!on)return;setTimeout(function(){var a=selected();if(a)post({type:"${ANNOTATE_SELECT_MESSAGE}",v:1,anchor:a})},0)},true);
D.addEventListener("keyup",function(e){if(on&&e.shiftKey){var a=selected();if(a)post({type:"${ANNOTATE_SELECT_MESSAGE}",v:1,anchor:a})}},true);
D.addEventListener("click",function(e){var id=hitAt(e);if(id){post({type:"${ANNOTATE_FOCUS_MESSAGE}",v:1,id:id});if(on){e.preventDefault();e.stopPropagation()}return}
if(!on)return;var sel=W.getSelection();if(sel&&!sel.isCollapsed)return;var el=e.target;if(!el||el.nodeType!==1||el===D.documentElement)return;if(el===D.body)return;e.preventDefault();e.stopPropagation();
post({type:"${ANNOTATE_SELECT_MESSAGE}",v:1,anchor:element(el)})},true);
var redraw=0;W.addEventListener("resize",function(){clearTimeout(redraw);redraw=setTimeout(function(){if(marks.length)draw(null)},200)});
})();`;

/** A reading frame's shared state (#1544, shared/page-state.ts), run first
 * after the prelude so the page's own scripts find it: window.sagax.page
 * with ready (a promise), get(key), entry(key) ({ value, name, at, who }),
 * all(), canWrite(key?) (this reader may write that key, or without a key
 * at least one), level(key) (anyone, signed_in, editors or owner, as the
 * page's sagax-state block declares), me() (this reader's handle on this
 * page: an entry's `who` when they set it), set(key, value) (a promise; null
 * clears) and subscribe(fn) (called with every value whenever the state
 * changes; returns the unsubscribe). It only ever posts to its parent, the
 * wrapper, which reads and writes this server's store with the reader's own
 * rights; the server applies the rules again. No network. */
export const STATE_BRIDGE_SOURCE = String.raw`(function(){"use strict";
var W=window,P=W.parent,state={},can=false,access=null,me="",subs=[],pending={},seq=0,done,ready=new Promise(function(r){done=r}),own=Object.prototype.hasOwnProperty;
function copy(v){return v===undefined?undefined:JSON.parse(JSON.stringify(v))}
function one(e){var o={value:copy(e.value),name:String(e.name||""),at:Number(e.at)||0};if(typeof e.who==="string")o.who=e.who;return o}
function all(){var o={};for(var k in state)if(own.call(state,k))o[k]=one(state[k]);return o}
function level(k){var r=access&&access.rules||{};if(own.call(r,k)&&k.slice(-1)!=="*")return r[k];var b=null,n=-1;for(var p in r){if(!own.call(r,p)||p==="*"||p.slice(-1)!=="*")continue;var s=p.slice(0,-1);if(k.indexOf(s)===0&&s.length>n){n=s.length;b=r[p]}}return b||(own.call(r,"*")?r["*"]:"signed_in")}
function may(k){if(!access)return can;if(access.locked&&access.locked.indexOf(k)>=0)return false;var l=level(k),ro=access.role;if(ro==="anon")return l==="anyone"&&access.publicLink===true;if(l==="anyone"||l==="signed_in")return true;if(l==="editors")return ro==="editor"||ro==="owner";return ro==="owner"}
W.addEventListener("message",function(e){if(e.source!==P||!e.data||e.data.v!==1)return;var d=e.data;
if(d.type==="${STATE_MESSAGE}"&&d.entries&&typeof d.entries==="object"){state=d.entries;can=d.canWrite===true;access=d.access&&typeof d.access==="object"?d.access:null;me=typeof d.me==="string"?d.me:"";done();var s=all();subs.slice().forEach(function(f){try{f(s)}catch(x){}})}
else if(d.type==="${STATE_RESULT_MESSAGE}"&&pending[d.id]){var p=pending[d.id];delete pending[d.id];if(d.ok)p.ok(true);else p.no(new Error(String(d.error||"refused")))}});
var page={ready:ready,
get:function(k){var e=state[k];return e?copy(e.value):undefined},
entry:function(k){var e=state[k];return e?one(e):undefined},
all:all,canWrite:function(k){return k===undefined?can:may(String(k))},
level:function(k){return level(String(k))},
me:function(){return me},
set:function(k,v){return new Promise(function(ok,no){var id=++seq;pending[id]={ok:ok,no:no};try{P.postMessage({type:"${STATE_SET_MESSAGE}",v:1,id:id,key:String(k),value:v===undefined?null:v},"*")}catch(x){delete pending[id];no(x)}})},
subscribe:function(f){if(typeof f!=="function")return function(){};subs.push(f);return function(){subs=subs.filter(function(g){return g!==f})}}};
try{Object.defineProperty(W,"sagax",{value:Object.freeze({page:Object.freeze(page)}),writable:false,configurable:false,enumerable:false})}catch(x){}
try{P.postMessage({type:"${STATE_ASK_MESSAGE}",v:1},"*")}catch(x){}
})();`;

/** The capability calls of a page that declares them (#3413,
 * shared/page-capabilities.ts), as members of window.sagax: `capabilities`
 * (what this version was granted, written here by the server), `data.read`,
 * `data.subscribe` (read again on the wrapper's `data` event), `viewer.get`
 * and `open`. Every call is one message to the parent, the wrapper, which
 * asks the server with the reader's own session; the server checks it
 * again. No network. Defines `caps` for the code that follows. Pure. */
function capabilityParts(caps: PageCapabilities): string {
  const granted = JSON.stringify({ data: caps.data, viewer: caps.viewer, open: caps.open }).replace(/</g, "\\u003c");
  // Handshake (#3413 lot 1b): the frame says hello once; the wrapper's broker
  // answers ready (and says ready once when it starts). Calls made before
  // that wait in a queue, each with its own bounded wait, then fail with
  // code "unavailable". No periodic timer.
  return String.raw`var C=${granted},cpend={},cseq=0,dsubs={},CP=window.parent,cready=false,cqueue=[];
function capPost(m){try{CP.postMessage(m,"*")}catch(x){var p=cpend[m.id];if(p){delete cpend[m.id];clearTimeout(p.t);p.no(x)}}}
function capCall(c,a){return new Promise(function(ok,no){var id=++cseq,m={type:"${CAP_MESSAGE}",v:1,id:id,cap:c,args:a||{}};cpend[id]={ok:ok,no:no,t:0};
if(cready){capPost(m);return}cqueue.push(m);cpend[id].t=setTimeout(function(){if(!cpend[id])return;delete cpend[id];cqueue=cqueue.filter(function(q){return q.id!==id});var er=new Error("The page's wrapper did not answer.");er.code="unavailable";no(er)},${CAP_READY_TIMEOUT_MS})})}
window.addEventListener("message",function(e){if(e.source!==CP||!e.data||e.data.v!==1)return;var d=e.data;
if(d.type==="${CAP_READY_MESSAGE}"){if(cready)return;cready=true;var q=cqueue;cqueue=[];q.forEach(function(m){var p=cpend[m.id];if(p){clearTimeout(p.t);capPost(m)}})}
else if(d.type==="${CAP_RESULT_MESSAGE}"&&typeof d.id==="number"&&cpend[d.id]){var p=cpend[d.id];delete cpend[d.id];clearTimeout(p.t);if(d.ok===true)p.ok(d.value);else{var er=new Error(String(d.message||d.error||"refused"));er.code=String(d.error||"");p.no(er)}}
else if(d.type==="${CAP_EVENT_MESSAGE}"&&d.cap==="data"&&typeof d.name==="string"&&dsubs[d.name]){var n=d.name;capCall("data.read",{name:n}).then(function(v){(dsubs[n]||[]).slice().forEach(function(f){try{f(v)}catch(x){}})},function(){})}});
try{CP.postMessage({type:"${CAP_HELLO_MESSAGE}",v:1},"*")}catch(x){}
var caps={capabilities:Object.freeze({data:Object.freeze(C.data.slice()),viewer:C.viewer,open:C.open}),
data:Object.freeze({read:function(n,q){return capCall("data.read",{name:String(n),params:q&&typeof q==="object"?q:{}})},
subscribe:function(n,f){n=String(n);if(typeof f!=="function")return function(){};(dsubs[n]=dsubs[n]||[]).push(f);return function(){dsubs[n]=(dsubs[n]||[]).filter(function(g){return g!==f})}}}),
viewer:Object.freeze({get:function(){return capCall("viewer.get",{})}}),
open:function(r){return capCall("open",{ref:String(r)})}};`;
}

/** The app's preview wrapper (a server document between the app and the
 * frame): it relays the capability messages between its own frame and its
 * parent, the app, where the broker runs, and nothing else. Calls and
 * hello go up only from its frame's window; results, events and ready go
 * down only from its parent. The frame keeps listening to its parent only. */
export const PREVIEW_CAP_RELAY_SOURCE = String.raw`(function(){"use strict";
var UP={"${CAP_MESSAGE}":1,"${CAP_HELLO_MESSAGE}":1},DOWN={"${CAP_RESULT_MESSAGE}":1,"${CAP_EVENT_MESSAGE}":1,"${CAP_READY_MESSAGE}":1};
addEventListener("message",function(e){var f=document.querySelector("iframe");if(!f||!e.data||e.data.v!==1||typeof e.data.type!=="string")return;var d=e.data;
if(e.source===f.contentWindow&&UP[d.type]===1){if(parent!==window)try{parent.postMessage(d,"*")}catch(x){}return}
if(e.source===parent&&parent!==window&&DOWN[d.type]===1){try{f.contentWindow.postMessage(d,"*")}catch(x){}}});
})();`;

const STATE_BRIDGE_DEFINE = `try{Object.defineProperty(W,"sagax",{value:Object.freeze({page:Object.freeze(page)}),writable:false,configurable:false,enumerable:false})}catch(x){}`;

/** A reading frame's bridge: today's state bridge exactly when the version
 * declares no capability (a golden test pins it), else the same with the
 * capability calls beside `page`. Pure. */
export function stateBridgeSource(caps?: PageCapabilities | null): string {
  if (!pageCapabilitiesAny(caps)) return STATE_BRIDGE_SOURCE;
  return STATE_BRIDGE_SOURCE.replace(STATE_BRIDGE_DEFINE,
    `${capabilityParts(caps)}\ntry{Object.defineProperty(W,"sagax",{value:Object.freeze(Object.assign({page:Object.freeze(page)},caps)),writable:false,configurable:false,enumerable:false})}catch(x){}`);
}

/** The app's preview frame has no shared state bridge: a page that declares
 * capabilities gets them alone on window.sagax. Pure. */
export function capabilityBridgeSource(caps: PageCapabilities): string {
  return `(function(){"use strict";${capabilityParts(caps)}\ntry{Object.defineProperty(window,"sagax",{value:Object.freeze(caps),writable:false,configurable:false,enumerable:false})}catch(x){}})();`;
}

/** A presentation prints one slide per sheet: each slide is this tall in
 * print, and the wrapper's sheet is 297 mm by this, with no margin. */
export const SLIDE_PRINT_MM = 167;

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
    // Real anchors: the open-link bridge posts them to the wrapper (no
    // allow-popups, no target=_blank preconnect). javascript: stays text.
    return url ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${label}</a>` : match;
  });
  // GFM autolinks: <https://x> and bare http(s) URLs become the same anchors.
  out = out.replace(/&lt;((?:https?:\/\/|mailto:)[^\s<>"']+?)&gt;/gi, (_m, href: string) => `<a class="url" href="${href}" rel="noopener noreferrer">${href}</a>`);
  out = out.replace(/(^|[\s(])((?:https?:\/\/)[^\s<>"']+?)(?=[.,;:!?)]*(?:\s|$))/gi, (_m, pre: string, href: string) => `${pre}<a class="url" href="${href}" rel="noopener noreferrer">${href}</a>`);
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return out.replace(/\uE000(\d+)\uE001/g, (_match, index: string) => codes[Number(index)] ?? "");
}

function tableCells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);
  return text.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function tableAligns(line: string): ("left" | "center" | "right" | "")[] | null {
  if (!line.includes("-") || !/^[\s|:-]+$/.test(line)) return null;
  const cells = tableCells(line);
  if (!cells.every((cell) => /^:?-+:?$/.test(cell))) return null;
  return cells.map((cell) => (cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : ""));
}

function tableToHtml(header: string[], aligns: ("left" | "center" | "right" | "")[], rows: string[][]): string {
  const cell = (tag: "th" | "td", text: string, column: number) => {
    const align = aligns[column];
    return `<${tag}${align ? ` style="text-align:${align}"` : ""}>${inline(escapeHtml(text))}</${tag}>`;
  };
  const head = `<thead><tr>${aligns.map((_a, column) => cell("th", header[column] ?? "", column)).join("")}</tr></thead>`;
  const body = rows.map((row) => `<tr>${aligns.map((_a, column) => cell("td", row[column] ?? "", column)).join("")}</tr>`).join("");
  return `<div class="table-wrap"><table>${head}<tbody>${body}</tbody></table></div>`;
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
    if (list) out.push(`<${list.tag}>${list.items.map((item) => {
      const task = /^\[([ xX])\]\s+(.*)$/.exec(item);
      return task ? `<li class="task">${task[1] === " " ? "\u2610" : "\u2611"} ${inline(escapeHtml(task[2]!))}</li>` : `<li>${inline(escapeHtml(item))}</li>`;
    }).join("")}</${list.tag}>`);
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
    if (line.includes("|") && index + 1 < lines.length) {
      const aligns = tableAligns(lines[index + 1]!);
      const header = aligns ? tableCells(line) : [];
      if (aligns && header.length === aligns.length) {
        flushParagraph();
        flushList();
        const rows: string[][] = [];
        index += 2;
        while (index < lines.length && lines[index]!.trim() && lines[index]!.includes("|")) rows.push(tableCells(lines[index++]!));
        index -= 1;
        out.push(tableToHtml(header, aligns, rows));
        continue;
      }
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

/** The full document a version is read as. `meta` adds the CSP as a meta tag
 * (the app's sandboxed preview, which has no response headers). Every kind
 * starts with the default theme (src/lib/page-theme.ts, 2026-10-28): the
 * app's theme and the person's skin tokens when the app's preview sent them
 * (`theme`, `skin`), light and dark by the reader's system otherwise (in
 * the page's person's own look when the server has it, `schemes`), and
 * the Geist face (`font`, an @font-face rule). An HTML page's own styles win
 * over it; a Markdown page or a presentation follows it entirely. Pure. */
export function pageDocument(input: { kind: PageKind; title: string; content: string; lang?: string }, options: { meta?: boolean; annotateNonce?: string; keepScroll?: number; nonce?: string; theme?: PageTheme; skin?: WidgetThemeTokens; schemes?: Partial<Record<PageTheme, WidgetThemeTokens>>; font?: string; reportSize?: boolean; capabilities?: PageCapabilities | null } = {}): string {
  const meta = options.meta ? `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(pageCsp(input.kind, { meta: true }))}">` : "";
  // Our own scripts: open-link bridge on every served frame (#1799);
  // annotation and place-keeping on the app's preview only. Markdown and
  // presentation run them by nonce; HTML runs them inline after the prelude.
  const nonce = options.annotateNonce ?? options.nonce;
  const own = (source: string) => pageIsHtml(input.kind) ? `<script>${source}</script>`
    : nonce !== undefined ? `<script nonce="${escapeHtml(nonce)}">${source}</script>` : "";
  const openBridge = own(OPEN_BRIDGE_SOURCE);
  const annotate = options.annotateNonce === undefined ? "" : own(ANNOTATE_SOURCE);
  const keep = (options.keepScroll === undefined ? "" : own(keepScrollSource(options.keepScroll)))
    + (options.reportSize ? own(REPORT_SIZE_SOURCE) + own(ANNOTATE_BRIDGE_SOURCE) : "");
  const scheme = `<meta name="color-scheme" content="${options.theme ?? "light dark"}">`;
  const theme = pageThemeStyle({ kind: input.kind, ...(options.theme ? { scheme: options.theme } : {}), ...(options.theme && options.skin ? { tokens: options.skin } : {}), ...(!options.theme && options.schemes ? { schemes: options.schemes } : {}), font: options.font ?? "",
    ...(input.kind === "presentation" ? { extra: `@media print{html{scroll-snap-type:none}.slide{height:${SLIDE_PRINT_MM}mm;border:0;break-after:page}.nav{display:none}}` } : {}) });
  if (input.kind === "markdown" || input.kind === "presentation") {
    const presentation = input.kind === "presentation";
    return `<!doctype html><html lang="${escapeHtml(input.lang ?? "fr")}"><head><meta charset="utf-8">${meta}${scheme}`
      + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)}</title>`
      + `${theme}</head>`
      + `<body>${presentation ? presentationToHtml(input.content) : markdownToHtml(input.content)}${openBridge}${annotate}${keep}</body></html>`;
  }
  // the theme first, so the page's own <style> and <link> come after it
  // (and win anyway: the theme sits in its cascade layer)
  // a reading frame: its shared state is there before the page's own scripts run (#1544)
  // #3413: a version that declares capabilities gets them on window.sagax
  // (beside the state in a reading frame, alone in the app's preview); one
  // that declares none gets exactly the frame it always had
  const caps = pageCapabilitiesAny(options.capabilities) ? options.capabilities : null;
  const bridge = options.reportSize ? `<script>${stateBridgeSource(caps)}</script>` : caps ? `<script>${capabilityBridgeSource(caps)}</script>` : "";
  const head = `${meta}${FRAME_PRELUDE}${openBridge}${bridge}${scheme}${theme}`;
  const content = neuterPageHtml(input.content);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(content);
  const page = doctype
    ? `${doctype[0]}${head}${content.slice(doctype[0].length)}`
    : `${head}${content}`;
  return `${page}${annotate}${keep}`;
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
  /** The app's own preview drawn inside the app (2026-10-28): no banner. */
  bare?: boolean;
  /** The app's theme, for the wrapper and the frame it draws. */
  theme?: PageTheme;
  /** The frame runs the place-keeping script (keepScrollSource). */
  keep?: boolean;
  /** Reader comments (a reading link with them on): the approved ones and
   * the form's action. A plain form, no script; the wrapper's CSP pins
   * form-action to that path. */
  comments?: { action: string; approved: ReaderComment[] };
  /** A reading link (2026-10-28): the bar instead of the banner, what the
   * bar's script is told, and that script's built tags (null when this
   * server has no built UI: the bar then shows the title and the notice). */
  reader?: { boot: ReaderBoot; assets: ReaderAssets | null; look?: PageLook | null; botHex?: string | null };
  /** A presentation's slide count, for its printed sheets. */
  slides?: number;
  /** Nonce for the wrapper's open-link listener (#1799). */
  openNonce?: string;
  /** #3413: the app's preview of a version that declares capabilities
   * relays them between its frame and the app (PREVIEW_CAP_RELAY_SOURCE). */
  capsRelay?: boolean;
}

/** The built tags of the reader's bar (dist/page-reader.html): paths under
 * /assets/ only. */
export interface ReaderAssets {
  scripts: string[];
  styles: string[];
  preloads: string[];
}

const ASSET_PATH = /^\/assets\/[A-Za-z0-9._-]+\.(?:js|css)$/;

/** The script, style and preload paths of a built page-reader.html, or
 * null when there is none to read. Only /assets/ paths are kept. Pure. */
export function parseReaderAssets(html: string): ReaderAssets | null {
  const pick = (pattern: RegExp) => [...html.matchAll(pattern)].map((match) => match[1]!).filter((path) => ASSET_PATH.test(path));
  const scripts = pick(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/g);
  if (!scripts.length) return null;
  return {
    scripts,
    styles: pick(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"/g),
    preloads: pick(/<link\b[^>]*\brel="modulepreload"[^>]*\bhref="([^"]+)"/g),
  };
}

/** A JSON block that no text inside can close or turn into markup. Pure. */
export function jsonBlock(id: string, value: unknown): string {
  const text = JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<script type="application/json" id="${escapeHtml(id)}">${text}</script>`;
}

const SHIELD_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>';

/** The reader's bar (2026-10-29): drawn in the page's person's look
 * (src/lib/page-look.ts `--sb-*`, written before this sheet), the title in
 * semibold, the byline with the bot's mascot, the warning as a quiet line
 * with its shield, the actions on the right; on a phone the byline goes
 * under the title and the actions keep their icons. */
const READER_BAR_STYLE = "body{background:var(--sb-app)}iframe{background:transparent}"
  + ".sagax-bar{flex:none;position:relative;z-index:2;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:'title actions' 'by actions';align-items:center;column-gap:16px;row-gap:2px;min-height:60px;box-sizing:border-box;padding:10px 14px 10px 20px;"
  + "background:var(--sb-bg);color:var(--sb-ink);border-bottom:1px solid color-mix(in srgb,var(--sb-line) 70%,transparent);font:13px/1.4 var(--sb-font);-webkit-font-smoothing:antialiased}"
  + ".sagax-bar h1{grid-area:title;align-self:end;margin:0;min-width:0;font-size:15px;font-weight:600;line-height:20px;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--sb-ink)}"
  + ".sagax-bar-by{grid-area:by;align-self:start;margin:0;min-width:0;display:flex;flex-wrap:wrap;align-items:center;column-gap:14px;row-gap:2px;font-size:12px;line-height:18px;color:var(--sb-ink-2)}"
  + ".sagax-bar-who{display:inline-flex;align-items:center;gap:6px;min-width:0}.sagax-bar-who b{font-weight:600;color:var(--sb-ink)}"
  + ".sagax-bar-mascot{flex:none;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;overflow:visible}"
  + ".sagax-bar-dot{display:block;width:10px;height:10px;border-radius:50%;box-shadow:inset 0 0 0 1px rgb(0 0 0/.12)}"
  + ".sagax-bar-warn{display:inline-flex;align-items:center;gap:5px;color:var(--sb-ink-3)}.sagax-bar-warn svg{flex:none}"
  + ".sagax-bar-actions{grid-area:actions;display:flex;align-items:center;gap:8px}"
  + "@media (max-width:640px){.sagax-bar{grid-template-areas:'title actions' 'by by';column-gap:10px;row-gap:4px;padding:8px 12px 10px 14px}.sagax-bar h1{align-self:center}.sagax-bar-actions{gap:6px}}";

/** Download PDF prints the wrapper: only the page, at its whole height
 * (--sagax-print-height, which the bar's script keeps from the frame's size
 * message), so the browser lays it out over as many sheets as it needs. */
const READER_PRINT_STYLE = "@media print{@page{margin:12mm}html,body{height:auto!important;display:block!important;overflow:visible!important;background:#fff!important}"
  + ".sagax-bar,.sagax-comments,.sagax-reader-overlay{display:none!important}iframe{display:block;flex:none;color-scheme:light!important;height:var(--sagax-print-height,100vh)!important}}";

/** A presentation's sheets: one slide each, landscape, no margin; the frame
 * prints all its slides whatever height it reported. Pure. */
export function slidesPrintStyle(slides: number): string {
  const count = Math.max(1, Math.min(500, Math.floor(slides) || 1));
  return `@media print{@page{size:297mm ${SLIDE_PRINT_MM}mm;margin:0}iframe{height:${count * SLIDE_PRINT_MM}mm!important}}`;
}

/** The reader's bar: the title, the notice (who published it for whom, not
 * a Sagax screen, never a password), always visible; the bot's mascot is
 * drawn by the bar's script into its box (a dot in the bot's color until
 * then, or without script); the actions are drawn into the empty box on the
 * right. Pure. */
export function readerBar(input: { title: string; botName: string; personName: string; lang: "fr" | "en"; botHex?: string | null }): string {
  const line = readerByline({ bot: bannerName(input.botName), person: bannerName(input.personName), lang: input.lang });
  const hex = input.botHex && /^#[0-9a-f]{6}$/i.test(input.botHex) ? input.botHex : null;
  const mascot = `<span class="sagax-bar-mascot" id="${READER_MASCOT_ID}" aria-hidden="true">${hex ? `<span class="sagax-bar-dot" style="background:${hex}"></span>` : ""}</span>`;
  const who = line.bot ? `${escapeHtml(line.before)}<b>${escapeHtml(line.bot)}</b>${escapeHtml(line.after)}` : escapeHtml(line.before);
  return `<header class="sagax-bar"><h1 title="${escapeHtml(input.title)}">${escapeHtml(input.title)}</h1>`
    + `<p class="sagax-bar-by sagax-bar-note" role="note"><span class="sagax-bar-who">${mascot}<span>${who}</span></span>`
    + `<span class="sagax-bar-warn">${SHIELD_ICON}<span>${escapeHtml(line.warning)}</span></span></p>`
    + `<div class="sagax-bar-actions" id="${READER_ACTIONS_ID}"></div></header>`;
}

/** The banner's words. Pure. */
export function wrapperBanner(input: Pick<WrapperInput, "botName" | "personName" | "lang" | "preview">): string {
  const bot = bannerName(input.botName);
  const person = bannerName(input.personName);
  if (input.preview) {
    return input.lang === "fr"
      ? `Aperçu d'une page proposée par ${bot} pour ${person} : ceci n'est pas un écran Sagax, n'y entre jamais de mot de passe.`
      : `Preview of a page proposed by ${bot} for ${person}: this is not a Sagax screen, never enter a password here.`;
  }
  return input.lang === "fr"
    ? `Page publiée par ${bot} pour ${person} : ceci n'est pas un écran Sagax, n'y entre jamais de mot de passe.`
    : `Page published by ${bot} for ${person}: this is not a Sagax screen, never enter a password here.`;
}

/** The reader's document: the bar (a reading link) or the banner (the
 * app's preview), then the page in its sandboxed frame. The bar's own
 * script, when this server has it built, runs in the wrapper only, never in
 * the page's frame. Pure. */
export function wrapperDocument(input: WrapperInput): string {
  // the app's own scripts (annotation, keeping the place) need scripts on a
  // Markdown page too: by their nonce only (pageCsp)
  // a reading link's frame runs its size script (Download PDF), by nonce on
  // a Markdown page
  const sandbox = pageFrameSandbox(input.kind);
  // a page that sets no background of its own shows the theme's, not white
  const background = input.theme === "dark" ? "#161616" : "#fff";
  const bare = input.bare === true && input.preview === true;
  // a reading link only: the app's preview keeps its banner (or none)
  const reader = input.preview ? undefined : input.reader;
  return `<!doctype html><html lang="${input.lang}"><head><meta charset="utf-8">`
    + (input.theme ? `<meta name="color-scheme" content="${input.theme}">` : "")
    + `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)}</title>`
    + "<style>html,body{margin:0;height:100%}body{display:flex;flex-direction:column;font:14px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}"
    + (input.theme ? `:root{color-scheme:${input.theme}}body{background:${background}}` : "")
    + ".sagax-banner{flex:none;padding:8px 14px;background:#fff4ce;color:#3d2e00;border-bottom:2px solid #d4a600;font-weight:600}"
    + `iframe{flex:1;border:0;width:100%;background:${input.theme ? "transparent" : "#fff"}${input.theme ? `;color-scheme:${input.theme}` : ""}}`
    + (input.comments ? COMMENTS_STYLE : "")
    + (reader ? readerBarThemeCss(reader.look, reader.botHex) + READER_BAR_STYLE + READER_PRINT_STYLE + (input.kind === "presentation" ? slidesPrintStyle(input.slides ?? 1) : "") : "")
    + "</style>"
    + (reader?.assets ? reader.assets.styles.map((path) => `<link rel="stylesheet" href="${escapeHtml(path)}">`).join("")
      + reader.assets.preloads.map((path) => `<link rel="modulepreload" href="${escapeHtml(path)}">`).join("") : "")
    + (input.openNonce
      ? `<script nonce="${escapeHtml(input.openNonce)}">${WRAPPER_OPEN_SOURCE}</script>`
      : `<script>${WRAPPER_OPEN_SOURCE}</script>`)
    + (input.capsRelay && input.preview
      ? (input.openNonce ? `<script nonce="${escapeHtml(input.openNonce)}">${PREVIEW_CAP_RELAY_SOURCE}</script>` : `<script>${PREVIEW_CAP_RELAY_SOURCE}</script>`)
      : "")
    + "</head><body>"
    + (reader ? readerBar({ ...input, botHex: reader.botHex ?? null }) : bare ? "" : `<div class="sagax-banner" role="note">${escapeHtml(wrapperBanner(input))}</div>`)
    + `<iframe src="${escapeHtml(input.frameUrl)}" sandbox="${sandbox}" referrerpolicy="no-referrer" allow="" title="${escapeHtml(input.title)}"></iframe>`
    + (input.comments ? commentsSection(input.comments, input.lang, input.personName) : "")
    + (reader ? jsonBlock(READER_BOOT_ID, reader.boot) : "")
    + (reader?.assets ? reader.assets.scripts.map((path) => `<script type="module" src="${escapeHtml(path)}"></script>`).join("") : "")
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
    + `<label>${fr ? "Ton nom" : "Your name"} <input name="name" required maxlength="${PAGE_LIMITS.readerNameChars}" autocomplete="name"></label>`
    + `<label>${fr ? "Commentaire" : "Comment"} <textarea name="text" required rows="3" maxlength="${PAGE_LIMITS.readerCommentChars}"></textarea></label>`
    + `<label class="trap" aria-hidden="true">Website <input name="website" tabindex="-1" autocomplete="off"></label>`
    + `<small>${escapeHtml(fr ? `Ton commentaire sera visible après l'approbation de ${bannerName(personName)}. N'y mets aucun renseignement personnel ni mot de passe.` : `Your comment shows once ${bannerName(personName)} approves it. Never put personal information or a password in it.`)}</small>`
    + `<button type="submit">${fr ? "Envoyer" : "Send"}</button></form></details>`;
}

/** The answer to a reader's comment: a plain page, no script, a link back. Pure. */
export function commentAnswerDocument(input: { lang: "fr" | "en"; back: string; ok: boolean; message?: string }): string {
  const fr = input.lang === "fr";
  const text = input.message ?? (input.ok
    ? (fr ? "Merci. Ton commentaire attend l'approbation de la personne qui a publié la page." : "Thank you. Your comment waits for the approval of the person who published the page.")
    : (fr ? "Ce commentaire n'a pas pu être envoyé." : "This comment could not be sent."));
  return `<!doctype html><html lang="${input.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${fr ? "Commentaire" : "Comment"}</title><style>body{font:15px/1.5 system-ui,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1rem}</style></head>`
    + `<body><p>${escapeHtml(text)}</p><p><a href="${escapeHtml(input.back)}">${fr ? "Revenir à la page" : "Back to the page"}</a></p></body></html>`;
}
