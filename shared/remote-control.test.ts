import { describe, expect, it } from "vitest";

import {
  coalesceEvents,
  createHelperFrameDecoder,
  encodeControlEvent,
  HELPER_FRAME_JPEG,
  HELPER_FRAME_META,
  NORM_MAX,
  parseControlEvent,
  type ControlEvent,
} from "./remote-control.ts";

describe("parseControlEvent", () => {
  it("accepts a move and clamps it into the normalized range", () => {
    expect(parseControlEvent({ t: "m", x: 42, y: 99 })).toEqual({ t: "m", x: 42, y: 99 });
    expect(parseControlEvent({ t: "m", x: -5, y: NORM_MAX + 50 })).toEqual({ t: "m", x: 0, y: NORM_MAX });
  });

  it("accepts buttons 0..2 and refuses others", () => {
    expect(parseControlEvent({ t: "d", b: 0 })).toEqual({ t: "d", b: 0 });
    expect(parseControlEvent({ t: "u", b: 2 })).toEqual({ t: "u", b: 2 });
    expect(parseControlEvent({ t: "d", b: 3 })).toBeNull();
    expect(parseControlEvent({ t: "d", b: 1.5 })).toBeNull();
  });

  it("bounds the wheel and the key code", () => {
    expect(parseControlEvent({ t: "w", d: 999 })).toEqual({ t: "w", d: 50 });
    expect(parseControlEvent({ t: "k", k: 65, d: 1 })).toEqual({ t: "k", k: 65, d: 1 });
    expect(parseControlEvent({ t: "k", k: 0, d: 1 })).toBeNull();
    expect(parseControlEvent({ t: "k", k: 300, d: 1 })).toBeNull();
    expect(parseControlEvent({ t: "k", k: 65, d: 2 })).toBeNull();
  });

  it("strips control characters from typed text and refuses empty text", () => {
    expect(parseControlEvent({ t: "x", s: "allo\u0000" })).toEqual({ t: "x", s: "allo" });
    expect(parseControlEvent({ t: "x", s: "\u0007" })).toBeNull();
    expect(parseControlEvent({ t: "x", s: 5 })).toBeNull();
  });

  it("refuses unknown shapes and bad JSON", () => {
    expect(parseControlEvent({ t: "nope" })).toBeNull();
    expect(parseControlEvent("not json")).toBeNull();
    expect(parseControlEvent("{\"t\":\"m\",\"x\":1,\"y\":2}")).toEqual({ t: "m", x: 1, y: 2 });
  });
});

describe("encodeControlEvent", () => {
  it("writes one fixed line per event", () => {
    expect(encodeControlEvent({ t: "m", x: 1, y: 2 })).toBe("m 1 2");
    expect(encodeControlEvent({ t: "d", b: 0 })).toBe("d 0");
    expect(encodeControlEvent({ t: "w", d: -3 })).toBe("w -3");
    expect(encodeControlEvent({ t: "k", k: 65, d: 1 })).toBe("k 65 1");
    expect(encodeControlEvent({ t: "x", s: "a b\"c" })).toBe("x \"a b\\\"c\"");
  });
});

describe("coalesceEvents", () => {
  it("keeps only the last move but never drops a click or key", () => {
    const events: ControlEvent[] = [
      { t: "m", x: 1, y: 1 },
      { t: "m", x: 2, y: 2 },
      { t: "d", b: 0 },
      { t: "m", x: 3, y: 3 },
      { t: "m", x: 4, y: 4 },
      { t: "u", b: 0 },
      { t: "m", x: 5, y: 5 },
    ];
    expect(coalesceEvents(events)).toEqual([
      { t: "m", x: 2, y: 2 },
      { t: "d", b: 0 },
      { t: "m", x: 4, y: 4 },
      { t: "u", b: 0 },
      { t: "m", x: 5, y: 5 },
    ]);
  });
});

function frame(type: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.length);
  out[0] = type;
  out[1] = (payload.length >>> 24) & 0xff;
  out[2] = (payload.length >>> 16) & 0xff;
  out[3] = (payload.length >>> 8) & 0xff;
  out[4] = payload.length & 0xff;
  out.set(payload, 5);
  return out;
}

describe("createHelperFrameDecoder", () => {
  it("decodes a meta frame and a jpeg frame, even split across chunks", () => {
    const decode = createHelperFrameDecoder();
    const meta = frame(HELPER_FRAME_META, new TextEncoder().encode(JSON.stringify({ w: 1920, h: 1080 })));
    const jpeg = frame(HELPER_FRAME_JPEG, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    const whole = new Uint8Array(meta.length + jpeg.length);
    whole.set(meta, 0);
    whole.set(jpeg, meta.length);
    // feed byte by byte
    const got: unknown[] = [];
    for (const byte of whole) {
      const result = decode(new Uint8Array([byte]));
      if (Array.isArray(result)) got.push(...result);
      else throw new Error("unexpected error");
    }
    expect(got).toEqual([
      { kind: "meta", meta: { w: 1920, h: 1080 } },
      { kind: "frame", bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) },
    ]);
  });

  it("errors on an oversize length and on an unknown type byte", () => {
    expect(createHelperFrameDecoder(10)(frame(HELPER_FRAME_JPEG, new Uint8Array(20)))).toEqual({ error: "oversize" });
    expect(createHelperFrameDecoder()(new Uint8Array([0x5a, 0, 0, 0, 1, 0]))).toEqual({ error: "protocol" });
  });

  it("rejects a meta frame whose JSON is not a positive size", () => {
    const bad = frame(HELPER_FRAME_META, new TextEncoder().encode(JSON.stringify({ w: 0, h: 10 })));
    expect(createHelperFrameDecoder()(bad)).toEqual({ error: "protocol" });
  });
});
