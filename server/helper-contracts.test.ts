// Copies that share a name and not a result (#1382). Swapping them would
// change a stored act digest, or read a member card as a permission sentence.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { canonicalJson } from "../shared/canonical-json.ts";
import { describeApproval as describeWording } from "../shared/approval-describe.ts";
import { valueDigest } from "./bots/bot-act.ts";
import { describeMemberApproval as describeMemberCard } from "./org/org-member-routes.ts";

describe("helpers that must stay apart", () => {
  it("keeps a missing field in an act digest, which the package form drops", () => {
    const value = { kept: 1, dropped: undefined };
    expect(canonicalJson(value)).toBe('{"kept":1}');
    const packageHash = createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 32);
    expect(valueDigest(value)).not.toBe(packageHash);
    expect(valueDigest({ kept: 1 })).toBe(createHash("sha256").update(canonicalJson({ kept: 1 })).digest("hex").slice(0, 32));
  });

  it("does not read a member card with the permission sentence", () => {
    const card = describeMemberCard("thread-1", { at: 1 }, {
      requestId: "r", title: "Run", tool: "Bash", requestType: "permission", options: ["Allow", "Deny"],
    });
    const words = describeWording("Bash", "pnpm test");
    expect(card).toMatchObject({ id: "r", threadId: "thread-1", kind: "permission", answerWith: "decision" });
    expect(words).not.toHaveProperty("threadId");
    expect(words.risk).toBe("execute");
  });
});
