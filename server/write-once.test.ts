import { describe, expect, it } from "vitest";

import { canonicalJson, executionKey, WriteOnce } from "./write-once.ts";

describe("WriteOnce", () => {
  it("the same key at once is one send; both get its answer", async () => {
    const once = new WriteOnce<string>();
    let sends = 0;
    const send = async () => { sends += 1; await new Promise(r => setTimeout(r, 10)); return "ok"; };
    const [a, b] = await Promise.all([once.run("k", send, () => true), once.run("k", send, () => true)]);
    expect(sends).toBe(1);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(b.value).toBe("ok");
  });

  it("never keeps a failure, and forgets a success after its window", async () => {
    let now = 0;
    const once = new WriteOnce<string>({ ttlMs: 1_000, now: () => now });
    let sends = 0;
    const answer = { value: "error" };
    const send = async () => { sends += 1; return answer.value; };
    await once.run("k", send, v => v === "ok");
    await once.run("k", send, v => v === "ok");
    expect(sends).toBe(2);
    answer.value = "ok";
    await once.run("k", send, v => v === "ok");
    expect((await once.run("k", send, v => v === "ok")).replayed).toBe(true);
    now = 1_001;
    expect((await once.run("k", send, v => v === "ok")).replayed).toBe(false);
    expect(sends).toBe(4);
  });

  it("a waiting send whose leader failed sends for real", async () => {
    const once = new WriteOnce<string>();
    let sends = 0;
    const send = async () => { sends += 1; await new Promise(r => setTimeout(r, 5)); return sends === 1 ? "error" : "ok"; };
    const [, b] = await Promise.all([once.run("k", send, v => v === "ok"), once.run("k", send, v => v === "ok")]);
    expect(sends).toBe(2);
    expect(b).toEqual({ value: "ok", replayed: false });
  });

  it("keys ignore argument order", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
    expect(executionKey(["s", { a: 1, b: 2 }])).toBe(executionKey(["s", { b: 2, a: 1 }]));
    expect(executionKey(["s", { a: 1 }])).not.toBe(executionKey(["s", { a: 2 }]));
  });
});

describe("perspicaxWriteOnceTool", () => {
  it("guards writes only, never reads, polls or leases", async () => {
    const { perspicaxWriteOnceTool } = await import("./perspicax-mcp.ts");
    for (const name of ["cw_psa__write", "cw_psa__action", "cw_psa__log_time", "cw_psa__book_schedule_entry", "cw_psa__update_ticket", "twilio_lookups__Bucket_write", "memory_write", "sagax_send"]) {
      expect(perspicaxWriteOnceTool(name), name).toBe(true);
    }
    for (const name of ["cw_psa__query", "cw_psa__get_ticket", "cw_psa__find_tickets", "await_turn", "send_prompt", "claim", "claim_renew", "identity", "api_plan", "read_transcript"]) {
      expect(perspicaxWriteOnceTool(name), name).toBe(false);
    }
  });
});
