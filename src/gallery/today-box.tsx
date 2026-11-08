// Dev preview of the Today box (the Approvals screen titled "Today"), for
// headless captures (QA 0.8.66 #12). It is the real ApprovalsPage over the
// synthetic fixtures of approvals-page.tsx, with the "needs you" card and the
// proactive proposal always on. Served by Vite in dev at
// /src/gallery/today-box.html; not part of the packaged app.
// ?n=0|3|40&lang=fr|en&skin=<id>&scope=org&routine=1 (same as approvals-page)
const params = new URLSearchParams(location.search);
params.set("today", "1");
if (!params.has("n")) params.set("n", "3");
history.replaceState(null, "", `${location.pathname}?${params}`);
await import("./approvals-page");
export {};
