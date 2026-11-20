// connector-files.ts (#5138, M-20261120-008): a file a connector returns is
// written into the person's own place and the engine reads a path there,
// never the bytes. Neutral sample data only.
import { describe, expect, it } from "vitest";

import { zipArchive } from "../testing/archive-fixtures.mjs";
import { connectorBlobs, connectorFileName, placeConnectorFiles, sniffExtension, type PersonPlace } from "./connector-files.ts";

/** A small spreadsheet as Office writes it: a zip naming xl/ parts. */
const SHEET = zipArchive([
  { name: "[Content_Types].xml", data: "<Types/>" },
  { name: "xl/workbook.xml", data: "<workbook/>" },
  { name: "xl/worksheets/sheet1.xml", data: "<worksheet><row><c>Osprey</c></row></worksheet>" },
]);

/** What Perspicax answers for a document download: the JSON (type, size,
 * hash, the vendor's headers) as text, the body as an embedded blob. */
function downloadAnswer(bytes: Buffer, headers: Record<string, string> = {}) {
  const sha256 = "ab".repeat(32);
  return {
    jsonrpc: "2.0",
    id: 7,
    result: {
      content: [
        { type: "text", text: JSON.stringify({ binary: { bytes: bytes.length, content_type: "application/octet-stream", sha256 }, handle: null, headers: { "content-length": String(bytes.length), "content-type": "application/octet-stream", ...headers } }) },
        { type: "resource", resource: { uri: `pulsatrix://result/${sha256}`, mimeType: "application/octet-stream", blob: bytes.toString("base64") } },
      ],
      isError: false,
    },
  };
}

/** A place that keeps what it is given, like the person's computer would. */
function memoryPlace(kind: PersonPlace["kind"], root: string, files = new Map<string, Buffer>()): PersonPlace & { files: Map<string, Buffer> } {
  return {
    kind,
    files,
    save: async (name, bytes) => {
      const path = `${root}/${name}`;
      files.set(path, Buffer.from(bytes));
      return path;
    },
  };
}

const failing = (kind: PersonPlace["kind"], why: string): PersonPlace => ({ kind, save: async () => { throw new Error(why); } });

describe("placeConnectorFiles", () => {
  it("writes a downloaded spreadsheet on the person's computer and gives the engine its path, never the bytes", async () => {
    const computer = memoryPlace("computer", "C:/Users/wren/AppData/Local/Temp/Sagax/attachments");
    const answer = downloadAnswer(SHEET);
    const placed = await placeConnectorFiles(answer, [computer, memoryPlace("environment", "/workspace/attachments")]) as typeof answer;

    expect(computer.files.size).toBe(1);
    const [path, bytes] = [...computer.files][0]!;
    expect(bytes.equals(SHEET)).toBe(true);
    expect(path).toMatch(/\/[0-9a-f]{8}-download\.xlsx$/);
    expect(JSON.stringify(placed)).not.toContain(SHEET.toString("base64"));
    expect(placed.result.content.some((part) => part.type === "resource")).toBe(false);
    const line = placed.result.content[1] as { type: string; text: string };
    expect(line.type).toBe("text");
    expect(line.text).toContain(path);
    expect(line.text).toContain("on the person's own computer");
    expect(line.text).toContain("attach_file");
    // the vendor's JSON beside it is left as it was
    expect(placed.result.content[0]).toEqual(answer.result.content[0]);
  });

  it("goes to the server environment when the computer cannot take it", async () => {
    const environment = memoryPlace("environment", "/workspace/attachments");
    const placed = await placeConnectorFiles(downloadAnswer(SHEET), [failing("computer", "The computer is offline."), environment]) as ReturnType<typeof downloadAnswer>;
    expect([...environment.files.values()][0]!.equals(SHEET)).toBe(true);
    expect((placed.result.content[1] as { text: string }).text).toContain("in the person's server environment: /workspace/attachments/");
  });

  it("keeps nothing when no place of the person can take it, and says why", async () => {
    const placed = await placeConnectorFiles(downloadAnswer(SHEET), []) as ReturnType<typeof downloadAnswer>;
    const text = JSON.stringify(placed);
    expect(text).not.toContain(SHEET.toString("base64"));
    expect(text).toContain("was not kept");
    expect(text).toContain("Nothing was saved on the Sagax server");
  });

  it("uses the vendor's own file name when it gave one", async () => {
    const computer = memoryPlace("computer", "/Users/wren/Library/Caches/Sagax/attachments");
    await placeConnectorFiles(downloadAnswer(SHEET, { "Content-Disposition": "attachment; filename=\"Osprey rates 2027.xlsx\"" }), [computer]);
    expect([...computer.files.keys()][0]).toMatch(/\/[0-9a-f]{8}-Osprey rates 2027\.xlsx$/);
  });

  it("returns an answer without a file as it is, and places each frame of a batch", async () => {
    const plain = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "{}" }] } };
    const computer = memoryPlace("computer", "/c");
    expect(await placeConnectorFiles(plain, [computer])).toBe(plain);
    const batch = await placeConnectorFiles([plain, downloadAnswer(SHEET)], () => [computer]) as unknown[];
    expect(batch[0]).toBe(plain);
    expect(computer.files.size).toBe(1);
  });
});

describe("connector file names", () => {
  it("names the kind of file by its bytes", () => {
    expect(sniffExtension(SHEET, "application/octet-stream")).toBe(".xlsx");
    expect(sniffExtension(Buffer.from("%PDF-1.7\n"), "application/octet-stream")).toBe(".pdf");
    expect(sniffExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]), "application/octet-stream")).toBe(".png");
    expect(sniffExtension(Buffer.from("plain"), "application/pdf")).toBe(".pdf");
    expect(sniffExtension(Buffer.from("plain"), "application/octet-stream")).toBe("");
  });

  it("keeps a name safe as one path component", () => {
    const [blob] = connectorBlobs(downloadAnswer(SHEET));
    expect(connectorFileName(blob!, "../../etc/passwd.xlsx")).toMatch(/^[0-9a-f]{8}-passwd\.xlsx$/);
    expect(connectorFileName(blob!, ".hidden")).not.toMatch(/-\./);
  });
});
