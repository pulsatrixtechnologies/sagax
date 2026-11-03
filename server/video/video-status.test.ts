import { describe, expect, it } from "vitest";
import { videoStatusRow } from "./video-status.ts";

describe("a video job's conversation row", () => {
  it("shows progress as a bar and words in the person's language", () => {
    const en = videoStatusRow({ status: "pending", progress: 37 }, "en");
    expect(en.text).toContain("Generating with xAI… 37 %");
    expect(en.text).toContain("37%");
    expect(JSON.stringify(en.root)).toContain("\"Progress\"");
    expect(videoStatusRow({ status: "pending", progress: 37 }, "fr-CA").text).toContain("Génération avec xAI… 37 %");
  });
  it("turns a failure, pause or stop into a receipt with no bar", () => {
    const failed = videoStatusRow({ status: "failed", code: "moderation", error: "English detail" }, "fr");
    expect(failed.text).toContain("La vidéo n'a pas pu être créée.");
    expect(failed.text).toContain("modération");
    expect(JSON.stringify(failed.root)).not.toContain("\"Progress\"");
    expect(videoStatusRow({ status: "paused", code: "timeout" }, "en").text).toContain("without paying twice");
    expect(videoStatusRow({ status: "failed", code: "brand_new_code", error: "xAI said no." }, "en").text).toContain("xAI said no.");
    expect(videoStatusRow({ status: "cancelled" }, "en").text).toContain("may still finish and be billed");
    for (const text of [failed.text, videoStatusRow({ status: "cancelled" }, "fr").text]) expect(text).not.toMatch(/[–—]/);
  });
});
