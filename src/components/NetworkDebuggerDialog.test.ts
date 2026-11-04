import { describe, expect, it } from "vitest";
import { filterNetworkRows, formatDebuggerBytes, formatMs, matchesStatus, networkTypes, type NetworkRow } from "./NetworkDebuggerDialog";

const row = (id: number, patch: Partial<NetworkRow>): NetworkRow => ({
  id, method: "GET", url: "https://example.test/", status: 200, statusText: "", resourceType: "Document", mimeType: "text/html",
  startedDateTime: "", time: null, timings: null, requestBodySize: null, responseBodySize: null, httpVersion: "",
  requestHeaders: [], responseHeaders: [], ...patch,
});

describe("network debugger view helpers", () => {
  const rows = [
    row(1, {}),
    row(2, { method: "POST", url: "https://api.example.test/items", status: 201, resourceType: "XHR" }),
    row(3, { url: "https://example.test/missing.png", status: 404, resourceType: "Image" }),
    row(4, { url: "https://blocked.example.test/", status: 0, resourceType: "Script" }),
  ];

  it("filters by text, method, type and status", () => {
    expect(filterNetworkRows(rows, "api.", "", "all").map((r) => r.id)).toEqual([2]);
    expect(filterNetworkRows(rows, "post", "", "all").map((r) => r.id)).toEqual([2]);
    expect(filterNetworkRows(rows, "", "Image", "all").map((r) => r.id)).toEqual([3]);
    expect(filterNetworkRows(rows, "", "", "error").map((r) => r.id)).toEqual([3]);
    expect(filterNetworkRows(rows, "", "", "failed").map((r) => r.id)).toEqual([4]);
    expect(filterNetworkRows(rows, "", "", "ok").map((r) => r.id)).toEqual([1, 2]);
    expect(matchesStatus(302, "redirect")).toBe(true);
    expect(networkTypes(rows)).toEqual(["Document", "Image", "Script", "XHR"]);
  });

  it("formats sizes and times", () => {
    expect(formatDebuggerBytes(null)).toBe("");
    expect(formatDebuggerBytes(512)).toBe("512 B");
    expect(formatDebuggerBytes(2048)).toBe("2.0 kB");
    expect(formatMs(25.4)).toBe("25 ms");
    expect(formatMs(1500)).toBe("1.50 s");
  });
});
