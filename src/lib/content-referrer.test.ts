import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MemeImage } from "@/components/MemeImage";
import { contentReferrerPolicy } from "./content-referrer";

describe("contentReferrerPolicy", () => {
  it("sends no Referer for an address a message wrote, even one aimed at the local server", () => {
    expect(contentReferrerPolicy("http://127.0.0.1:8799/api/bots")).toBe("no-referrer");
    expect(contentReferrerPolicy("https://media.example.test/a.gif")).toBe("no-referrer");
    expect(contentReferrerPolicy("//media.example.test/a.gif")).toBe("no-referrer");
    expect(contentReferrerPolicy("HTTP:127.0.0.1:8799/api/x")).toBe("no-referrer");
  });

  it("keeps the app's own relative pictures as they are", () => {
    expect(contentReferrerPolicy("/api/threads/t/messages/m/file?preview=1&ref=3")).toBeUndefined();
    expect(contentReferrerPolicy("data:image/png;base64,AAAA")).toBeUndefined();
  });

  it("draws a bare picture of a message with no Referer", () => {
    const html = renderToStaticMarkup(createElement(MemeImage, { src: "http://127.0.0.1:8799/api/bots", alt: "x" }));
    expect(html).toContain('referrerPolicy="no-referrer"');
    const own = renderToStaticMarkup(createElement(MemeImage, { src: "/api/attachments/a.gif", alt: "x" }));
    expect(own).not.toContain("referrerPolicy");
  });
});
