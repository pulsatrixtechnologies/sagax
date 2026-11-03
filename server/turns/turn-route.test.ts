import { describe, expect, it } from "vitest";
import { turnDestination } from "./turn-route.ts";

describe("turn destination", () => {
  it("queues a message when the chosen machine is offline", () => {
    expect(turnDestination({
      host: { kind: "machine", userId: "morgan@example.test", deviceId: "laptop" },
      workerOnline: false,
    })).toEqual({ kind: "queued" });
  });
  it("keeps a fleet bot on the fleet host", () => {
    expect(turnDestination({ host: { kind: "fleet" }, workerOnline: false })).toEqual({ kind: "fleet" });
  });
  it("sends a machine-hosted turn to that worker when it is online", () => {
    expect(turnDestination({
      host: { kind: "machine", userId: "morgan@example.test", deviceId: "laptop" },
      workerOnline: true,
    })).toEqual({ kind: "worker", deviceId: "laptop" });
  });
  it("keeps a fleet bot on the fleet host even when a worker is online", () => {
    expect(turnDestination({ host: { kind: "fleet" }, workerOnline: true })).toEqual({ kind: "fleet" });
  });
});
