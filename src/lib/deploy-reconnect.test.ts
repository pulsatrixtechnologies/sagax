import { describe, expect, it } from "vitest";

import {
  DEPLOY_OUTAGE_QUIET_MS,
  isDeployOutageFailure,
  isDeployOutageQuiet,
  shouldSuppressDeployOutageError,
} from "./deploy-reconnect";

describe("deploy reconnect quiet window", () => {
  it("treats 502/503/connection refused as a deploy outage", () => {
    expect(isDeployOutageFailure(Object.assign(new Error("Bad Gateway"), { status: 502 }))).toBe(true);
    expect(isDeployOutageFailure(Object.assign(new Error("x"), { status: 503 }))).toBe(true);
    expect(isDeployOutageFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isDeployOutageFailure(new Error("connect ECONNREFUSED 127.0.0.1:8799"))).toBe(true);
    expect(isDeployOutageFailure(Object.assign(new Error("No."), { status: 400 }))).toBe(false);
    expect(isDeployOutageFailure(Object.assign(new Error("missing"), { status: 404 }))).toBe(false);
  });

  it("stays quiet under 30 s after disconnect", () => {
    expect(isDeployOutageQuiet(1_000, 1_000 + DEPLOY_OUTAGE_QUIET_MS - 1)).toBe(true);
    expect(isDeployOutageQuiet(1_000, 1_000 + DEPLOY_OUTAGE_QUIET_MS)).toBe(false);
    expect(isDeployOutageQuiet(null, 5_000)).toBe(false);
    expect(isDeployOutageQuiet(undefined, 5_000)).toBe(false);
  });

  it("suppresses error toasts only while reconnecting after a live session", () => {
    const failure = Object.assign(new Error("502 Bad Gateway"), { status: 502 });
    expect(
      shouldSuppressDeployOutageError({
        failure,
        everConnected: true,
        connected: false,
        disconnectedAt: 1_000,
        now: 5_000,
      }),
    ).toBe(true);
    expect(
      shouldSuppressDeployOutageError({
        failure,
        everConnected: true,
        connected: true,
        disconnectedAt: 1_000,
        now: 5_000,
      }),
    ).toBe(false);
    expect(
      shouldSuppressDeployOutageError({
        failure,
        everConnected: false,
        connected: false,
        disconnectedAt: 1_000,
        now: 5_000,
      }),
    ).toBe(false);
    expect(
      shouldSuppressDeployOutageError({
        failure,
        everConnected: true,
        connected: false,
        disconnectedAt: 1_000,
        now: 1_000 + DEPLOY_OUTAGE_QUIET_MS + 1,
      }),
    ).toBe(false);
    expect(
      shouldSuppressDeployOutageError({
        failure: Object.assign(new Error("No."), { status: 403 }),
        everConnected: true,
        connected: false,
        disconnectedAt: 1_000,
        now: 5_000,
      }),
    ).toBe(false);
  });
});
