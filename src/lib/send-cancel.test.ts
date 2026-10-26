import { describe, expect, it, beforeEach } from "vitest";
import { beginLocalSend, cancelLocalSend, claimInFlightSend, finishSend, resetSendCancel } from "./send-cancel";

describe("cancel a reply that has not left", () => {
  beforeEach(() => resetSendCancel());

  it("cancels while the send is only on screen", () => {
    beginLocalSend("s1");
    expect(cancelLocalSend("s1")).toBe("cancelled");
    expect(claimInFlightSend("s1")).toBe(false);
  });

  it("refuses once the request is on the wire", () => {
    beginLocalSend("s1");
    expect(claimInFlightSend("s1")).toBe(true);
    expect(cancelLocalSend("s1")).toBe("already-sending");
  });

  it("refuses a send it does not know", () => {
    expect(cancelLocalSend("gone")).toBe("already-sending");
    finishSend("s1");
  });
});
