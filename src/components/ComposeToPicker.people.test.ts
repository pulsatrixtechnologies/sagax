// The To: picker on an organization server: the directory's people follow
// the bots, choosing one opens the direct conversation with them, and a
// service account, a disabled person or oneself is never offered.
import { createElement, isValidElement, Children, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot, ConfigStatus } from "@/state/store";
import type { OrgDirectoryPerson } from "@/lib/perspicax-org";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), people: new Map<string, unknown>() }));
vi.mock("./DesktopCapabilities", () => ({
  useCaptionChrome: () => ({ dragStyle: undefined, noDragStyle: undefined, controlsShiftStyle: undefined }),
}));
vi.mock("@/lib/perspicax-org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/perspicax-org")>()),
  useOrgPeople: () => fixture.people,
}));
vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: { ...original.initialState, bots: [] as Bot[], botCreationPending: false, config: { viewer: { principalId: "pr_alice" } } as unknown as ConfigStatus },
      dispatch: fixture.dispatch,
    }),
  };
});

import { ComposeToPicker, composePeople, composeRows } from "./ComposeToPicker";

const person = (principalId: string, name: string, extra: Partial<OrgDirectoryPerson> = {}): OrgDirectoryPerson => ({ principalId, name, login: name.toLowerCase(), role: "member", disabled: false, ...extra });

type Node = ReactElement<{ children?: ReactNode; onClick?: () => void; "data-compose-person"?: string }>;
function nodes(value: ReactNode): Node[] {
  if (!isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...Children.toArray(node.props.children).flatMap(nodes)];
}

describe("ComposeToPicker people", () => {
  const people = [
    person("pr_alice", "Alice"),
    person("pr_bob", "Bob", { avatarUrl: "/api/people/pr_bob/avatar?v=1" }),
    person("pr_robot", "Robot", { service: true }),
    person("pr_old", "Old", { disabled: true }),
  ];

  it("offers active persons other than oneself, matched by the query", () => {
    expect(composePeople(people, "pr_alice", "").map((p) => p.principalId)).toEqual(["pr_bob"]);
    expect(composePeople(people, "pr_alice", "zz")).toEqual([]);
    expect(composeRows("browse", [], true, [people[1]!]).map((row) => row.kind)).toEqual(["create-bot", "create-group", "person"]);
    expect(composeRows("group", [], true, [people[1]!]).map((row) => row.kind)).toEqual(["create-group", "person"]);
  });

  it("opens the direct conversation with the person chosen", () => {
    fixture.people = new Map(people.map((p) => [p.principalId, p]));
    fixture.dispatch.mockReset();
    const close = vi.fn();
    let tree!: ReturnType<typeof ComposeToPicker>;
    const html = renderToStaticMarkup(createElement(() => { tree = ComposeToPicker({ onClose: close }); return tree; }));
    expect(html).toContain("Bob");
    expect(html).not.toContain("Robot");
    expect(html).not.toContain(">Old<");
    expect(html).not.toContain('data-compose-person="pr_alice"');
    const row = nodes(tree).find((node) => node.props["data-compose-person"] === "pr_bob");
    row!.props.onClick!();
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "openPeopleDm", principalId: "pr_bob" });
    expect(close).toHaveBeenCalled();
  });
});
