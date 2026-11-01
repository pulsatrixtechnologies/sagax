import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AttachedFileChips,
  AttachedImageGallery,
  MarkdownImagePreview,
  OutsideWorkspaceFile,
  canonicalDownloadFilename,
  contentDispositionFilename,
  imageGalleryLayout,
  isExternalImageSource,
  messageImagePreviewUrl,
  previewImage,
  previewKeyAction,
  requestMessageFileLocation,
  safeDownloadFilename,
  steppedZoom,
  MAX_ZOOM,
  saveFailureText,
  wrappedImageIndex,
} from "./AttachmentPreview";

afterEach(() => vi.unstubAllGlobals());

describe("lightbox zoom", () => {
  it("maps zoom keys whatever the image count", () => {
    expect(previewKeyAction("+", 1)).toBe("zoom-in");
    expect(previewKeyAction("=", 1)).toBe("zoom-in");
    expect(previewKeyAction("-", 4)).toBe("zoom-out");
    expect(previewKeyAction("0", 1)).toBe("zoom-reset");
  });

  it("steps zoom by half again, clamped between fit and the maximum", () => {
    expect(steppedZoom(1, 1)).toBe(1.5);
    expect(steppedZoom(1.5, -1)).toBe(1);
    expect(steppedZoom(1, -1)).toBe(1);
    let zoom = 1;
    for (let step = 0; step < 20; step += 1) zoom = steppedZoom(zoom, 1);
    expect(zoom).toBe(MAX_ZOOM);
  });
});

describe("attachment image navigation", () => {
  it("wraps previous and next navigation", () => {
    expect(wrappedImageIndex(0, -1, 3)).toBe(2);
    expect(wrappedImageIndex(2, 1, 3)).toBe(0);
    expect(wrappedImageIndex(0, 1, 0)).toBe(0);
  });

  it("maps preview keys only when the action is available", () => {
    expect(previewKeyAction("Escape", 1)).toBe("close");
    expect(previewKeyAction("ArrowLeft", 3)).toBe("previous");
    expect(previewKeyAction("ArrowRight", 3)).toBe("next");
    expect(previewKeyAction("ArrowRight", 1)).toBeNull();
    expect(previewKeyAction("Enter", 3)).toBeNull();
  });

  it("uses compact responsive grids for one, two, and many images", () => {
    expect(imageGalleryLayout(1)).toContain("grid-cols-1");
    expect(imageGalleryLayout(2)).toContain("grid-cols-2");
    expect(imageGalleryLayout(3)).toContain("sm:grid-cols-3");
  });
});

describe("attachment download filenames", () => {
  it("prefers the UTF-8 server filename and makes it portable", () => {
    expect(contentDispositionFilename(
      `attachment; filename="fallback.md"; filename*=UTF-8''..%2Fnotes%2Fr%C3%A9sum%C3%A9%20%22final%22.md`,
    )).toBe("résumé _final_.md");
    expect(safeDownloadFilename("../../AUX.txt")).toBe("_AUX.txt");
    expect(safeDownloadFilename(`bad\u202ename\ud800.txt`)).toBe("badname.txt");
  });

  it("uses a safe fallback when the response has no filename", () => {
    expect(canonicalDownloadFilename({
      fallback: "../reports/quarterly?.pdf",
      source: "/private/attachment.pdf",
      mime: "application/pdf",
    })).toBe("quarterly_.pdf");
  });

  it("lets image bytes or their canonical source override a spoofed extension", () => {
    expect(canonicalDownloadFilename({
      contentDisposition: `attachment; filename="setup.exe"`,
      source: "/private/opaque",
      mime: "image/png",
    })).toBe("setup.png");
    expect(canonicalDownloadFilename({
      contentDisposition: `attachment; filename="holiday.pdf"`,
      source: "/api/attachments/123.jpeg?download=1",
    })).toBe("holiday.jpeg");
  });
});

describe("opaque message file locations", () => {
  const message = { threadId: "thread/one", messageId: "message two" };
  const answer = {
    downloadUrl: "/api/threads/thread%2Fone/files/0123456789abcdef01234567",
    previewUrl: "/api/threads/thread%2Fone/files/0123456789abcdef01234567?preview=1",
    name: "clip.mp4",
    mime: "video/mp4",
    bytes: 1024 * 1024 * 1024,
  };

  it("accepts only this thread's path-free opaque URLs", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(answer), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    await expect(requestMessageFileLocation("/private/clip.mp4", message, signal)).resolves.toEqual(answer);
    expect(fetcher).toHaveBeenCalledWith("/api/threads/thread%2Fone/messages/message%20two/file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/private/clip.mp4", location: true }),
      signal,
    });
  });

  it("refuses another origin, another thread, a host path, and invalid sizes", async () => {
    for (const patch of [
      { downloadUrl: "https://example.test/file" },
      { previewUrl: "/api/threads/other/files/0123456789abcdef01234567?preview=1" },
      { previewUrl: "/api/threads/thread%2Fone/files/1123456789abcdef01234567?preview=1" },
      { downloadUrl: "/Users/alice/clip.mp4" },
      { bytes: -1 },
    ]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ...answer, ...patch }), { headers: { "content-type": "application/json" } })));
      await expect(requestMessageFileLocation("/private/clip.mp4", message, new AbortController().signal)).rejects.toThrow("download");
    }
  });

  it("marks an old non-JSON server response for bounded compatibility fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("video", { headers: { "content-type": "video/mp4" } })));
    await expect(requestMessageFileLocation("/private/clip.mp4", message, new AbortController().signal))
      .rejects.toMatchObject({ code: "streaming_location_unavailable" });
  });
});

describe("external image privacy", () => {
  it("classifies the image source independently from an outer link", () => {
    expect(isExternalImageSource("https://assets.example/image.png")).toBe(true);
    expect(isExternalImageSource("//assets.example/image.png")).toBe(true);
    expect(isExternalImageSource("https:assets.example/image.png")).toBe(true);
    expect(isExternalImageSource("https:/assets.example/image.png")).toBe(true);
    expect(isExternalImageSource("https:\\assets.example\\image.png")).toBe(true);
    expect(isExternalImageSource("HTTP:assets.example/pixel.gif")).toBe(true);
    expect(isExternalImageSource("/\t/assets.example/pixel.gif")).toBe(true);
    expect(isExternalImageSource("/\n/assets.example/pixel.gif")).toBe(true);
    expect(isExternalImageSource("/\r/assets.example/pixel.gif")).toBe(true);
    expect(isExternalImageSource("\\\\assets.example\\pixel.gif")).toBe(true);
    expect(isExternalImageSource("/api/attachments/image.png")).toBe(false);
  });
});

describe("attachment preview surfaces", () => {
  it("keeps a stable loading tile and the original image name", () => {
    const html = renderToStaticMarkup(createElement(AttachedImageGallery, {
      paths: [{
        path: "/store/123e4567-e89b-12d3-a456-426614174000.png",
        name: "Launch artwork.png",
        private: true,
      }],
    }));

    expect(html).toContain("aspect-[4/3]");
    expect(html).toContain("Loading Launch artwork.png");
    expect(html).toContain("Preview attached image Launch artwork.png");
    expect(html).toContain("/api/attachments/123e4567-e89b-12d3-a456-426614174000.png");
    expect(html).toContain("loading=\"lazy\"");
    expect(html).not.toContain("fetchPriority=\"high\"");
  });

  it("can prioritize a newly sent image without making old galleries eager", () => {
    const html = renderToStaticMarkup(createElement(AttachedImageGallery, {
      paths: ["/store/123e4567-e89b-12d3-a456-426614174000.png"],
      eager: true,
    }));

    expect(html).toContain("loading=\"eager\"");
    expect(html).toContain("fetchPriority=\"high\"");
  });

  it("keeps remote Markdown images private until explicitly loaded", () => {
    const html = renderToStaticMarkup(createElement(MarkdownImagePreview, {
      src: "https://assets.example/preview.png?signature=abc",
      name: "Result image",
      openUrl: "https://assets.example/preview.png?signature=abc",
    }));

    expect(html).toContain("External image hidden for privacy");
    expect(html).toContain("Load image");
    expect(html).not.toContain("src=\"https://assets.example/preview.png?signature=abc\"");
    expect(html).toContain("https://assets.example/preview.png?signature=abc");
  });

  it("does not need an outer link to hide a remote Markdown image", () => {
    const html = renderToStaticMarkup(createElement(MarkdownImagePreview, {
      src: "//assets.example/preview.png",
      name: "Result image",
    }));

    expect(html).toContain("External image hidden for privacy");
    expect(html).not.toContain("src=\"//assets.example/preview.png\"");
  });

  it("uses the stored image extension for downloads, not the display label", () => {
    expect(previewImage(
      "/store/123e4567-e89b-12d3-a456-426614174000.png",
      "quarterly-report.pdf",
    )?.downloadName).toBe("quarterly-report.png");
  });

  it("keeps legacy transcript file chips visible but inert", () => {
    const html = renderToStaticMarkup(createElement(AttachedFileChips, {
      files: [{ path: "/store/123e4567-e89b-42d3-a456-426614174000.pdf", name: "Final report.pdf", private: true }],
    }));

    expect(html).toContain("Final report.pdf");
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("type=\"button\"");
  });

  it("makes message-authorized transcript files explicit save actions", () => {
    const html = renderToStaticMarkup(createElement(AttachedFileChips, {
      files: [{ path: "/store/123e4567-e89b-42d3-a456-426614174000.pdf", name: "Final report.pdf", private: true }],
      message: { threadId: "thread-1", messageId: "message-1" },
    }));
    expect(html).toContain("Save a copy of Final report.pdf");
    expect(html).toContain("type=\"button\"");
  });
});

describe("Show in folder for a file outside the workspace", () => {
  const render = (filePath: string) => renderToStaticMarkup(createElement(OutsideWorkspaceFile, { filePath }));

  it("offers the reveal only for an absolute local path, and only in the local desktop app", () => {
    vi.stubGlobal("window", { ogb: { revealInFolder: vi.fn(), remoteClient: { active: false } } });
    try {
      expect(render("/Users/maus/_draft/ollama-gen.js")).toContain("Show in folder");
      expect(render("C:\\Users\\Maus\\_draft\\ollama-gen.js")).toContain("Show in folder");
      // main refuses these, so the person gets the path to look for instead
      for (const filePath of ["_draft/ollama-gen.js", "\\\\server\\share\\ollama-gen.js"]) {
        expect(render(filePath)).not.toContain("Show in folder");
        expect(render(filePath)).toContain(`>${filePath}</code>`);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("gives a remote client the path, since the file is not on its computer", () => {
    vi.stubGlobal("window", { ogb: { revealInFolder: vi.fn(), remoteClient: { active: true } } });
    try {
      expect(render("/Users/maus/_draft/ollama-gen.js")).toContain(">/Users/maus/_draft/ollama-gen.js</code>");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("a failed save", () => {
  it("explains a file outside the working folder instead of echoing the server", () => {
    const server = "the linked file is outside this conversation's workspace";
    expect(saveFailureText({ reason: server, outsideWorkspace: true }))
      .toBe("This file is outside this chat's working folder, so it can't be saved from here");
    expect(saveFailureText({ reason: "the linked file is unavailable", outsideWorkspace: false }))
      .toBe("the linked file is unavailable");
  });
});

describe("local Markdown image lifecycle", () => {
  it("builds a path-free, directly streamable message preview URL", () => {
    expect(messageImagePreviewUrl(
      { threadId: "thread-one", messageId: "message-two" },
      42,
    )).toBe(
      "/api/threads/thread-one/messages/message-two/file?preview=1&ref=42",
    );
  });
});
