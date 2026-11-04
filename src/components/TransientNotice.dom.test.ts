// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TransientNotice } from "./TransientNotice";
import { readShownNotices } from "@/lib/transient-notice";
import { setLocale } from "@/lib/i18n";
import { TRANSIENT_NOTICE_RULES } from "../../shared/transient-notices";
import type { Message } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const failure = (index: number): Message => ({ id: `failure-${index}`, at: Date.now(), role: "bot", kind: "routine.run", text: "", routineRun: { runId: `run-${index}`, routineId: `routine-${index}`, routineName: `Report ${index}`, status: "failed" } } as Message);
const renderNotice = (message: Message, close: () => void) => createElement("button", { onClick: close, "data-run": message.id }, message.routineRun?.routineName ?? "Access");
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  setLocale("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
const draw = (messages: Message[], settled?: (message: Message) => boolean) => act(() => root.render(createElement(TransientNotice, { messages, render: renderNotice, settled })));

const expand = () => act(() => {
  const details = host.querySelector("details")!;
  details.open = true;
  details.dispatchEvent(new Event("toggle"));
});

it("groups failures arriving in separate frames, with each run still reachable", () => {
  const messages: Message[] = [];
  for (let index = 0; index < 30; index++) {
    messages.push(failure(index));
    draw([...messages]);
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
  }
  expect(host.querySelector("summary")?.textContent).toBe("Failed routine runs (30)");
  expect(host.querySelectorAll("[data-run]")).toHaveLength(0);
  expand();
  expect(host.querySelectorAll("[data-run]")).toHaveLength(30);
  expect(readShownNotices().size).toBe(30);
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
  act(() => vi.advanceTimersByTime(TRANSIENT_NOTICE_RULES.visibleMs * 31));
  draw([...messages]);
  expect(host.textContent).toBe("");
});

it("expires the whole burst once, without extending the first banner's timer", () => {
  const first = failure(1);
  draw([first]);
  act(() => vi.advanceTimersByTime(TRANSIENT_NOTICE_RULES.visibleMs - 100));
  draw([first, failure(2)]);
  act(() => vi.advanceTimersByTime(100));
  expect(host.textContent).toBe("");
  act(() => vi.advanceTimersByTime(TRANSIENT_NOTICE_RULES.visibleMs));
  expect(host.textContent).toBe("");
});

it("keeps single notices, per-run actions and auto-pause settlement", () => {
  const first = failure(1);
  const second = failure(2);
  draw([first]);
  expect(host.querySelector("summary")).toBeNull();
  draw([first, second]);
  expand();
  act(() => host.querySelector<HTMLButtonElement>('[data-run="failure-1"]')!.click());
  expect(host.querySelector('[data-run="failure-1"]')).toBeNull();
  expect(host.querySelector('[data-run="failure-2"]')).not.toBeNull();
  draw([first, second], () => true);
  expect(host.textContent).toBe("");
});

it("keeps access cards separate, then groups the queued failures", () => {
  const access = { id: "access", at: Date.now(), role: "bot", kind: "access", text: "", access: { routine: true, reason: "no_access", botId: "osprey" } } as Message;
  draw([access]);
  draw([access, failure(1), failure(2)]);
  expect(host.querySelector("summary")).toBeNull();
  expect(host.textContent).toContain("Access");
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
  expect(host.querySelector("summary")?.textContent).toBe("Failed routine runs (2)");
});

it("does not revive a burst on remount or include stale failures", () => {
  const messages = [{ ...failure(3), at: Date.now() - TRANSIENT_NOTICE_RULES.freshMs - 1 }, failure(1), failure(2)];
  draw(messages);
  expand();
  expect(host.querySelectorAll("[data-run]")).toHaveLength(2);
  act(() => root.unmount());
  root = createRoot(host);
  draw(messages);
  expect(host.textContent).toBe("");
});

it("renders the reviewed French summary", () => {
  setLocale("fr");
  draw([failure(1), failure(2)]);
  expect(host.querySelector("summary")?.textContent).toBe("Exécutions de routine en échec (2)");
});
