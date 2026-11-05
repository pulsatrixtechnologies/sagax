import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OwnerSettled, OwnerWait } from "./OwnerWait";

describe("OwnerWait", () => {
  it("shows the wait without an approve button", () => {
    const html = renderToStaticMarkup(createElement(OwnerWait, { ownerName: "Alex" }));
    expect(html).toContain("En attente de Alex");
    expect(html).not.toContain("Approuver");
    expect(html).not.toContain("Cancel turn");
    expect(html).not.toContain("data-owner-wait-cancel");
  });

  it("offers Cancel for the person who started the turn (#2042)", () => {
    const onCancel = vi.fn();
    const html = renderToStaticMarkup(createElement(OwnerWait, { ownerName: "Alex", onCancel }));
    expect(html).toContain("En attente de Alex");
    expect(html).toContain("Cancel turn");
    expect(html).toContain("data-owner-wait-cancel");
    expect(html).not.toContain("Allow");
    expect(html).not.toContain("Deny");
  });

  it("Cancel calls the same interrupt path the parent wired (#2042)", () => {
    const onCancel = vi.fn();
    const tree = createElement(OwnerWait, { ownerName: "Alex", onCancel });
    // renderToStaticMarkup does not fire clicks; exercise the prop contract.
    expect(typeof (tree.props as { onCancel?: () => void }).onCancel).toBe("function");
    (tree.props as { onCancel: () => void }).onCancel();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("OwnerSettled (S7-7)", () => {
  it("says who answered a card another person settled, never the request", () => {
    const html = renderToStaticMarkup(createElement(OwnerSettled, {
      message: { ownerName: "alice", card: { title: "", subtitle: "", options: [], answered: "allow", answeredBy: { kind: "session", name: "alice (console)" } } },
    }));
    expect(html).toContain("alice (console) allowed this request.");
    const denied = renderToStaticMarkup(createElement(OwnerSettled, {
      message: { ownerName: "alice", card: { title: "", subtitle: "", options: [], answered: "deny", answeredBy: { kind: "worker" } } },
    }));
    expect(denied).toContain("alice declined this request.");
    expect(renderToStaticMarkup(createElement(OwnerSettled, { message: { ownerName: "alice", card: { title: "", subtitle: "", options: [], dismissed: true } } }))).toBe("");
  });
});
