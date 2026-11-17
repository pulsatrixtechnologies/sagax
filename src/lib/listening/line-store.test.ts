// #4100: the live transcript's line store: the line being spoken is replaced
// by its final line, a seq is shown once, speakers keep their labels.
import { describe, expect, it } from "vitest";

import { EMPTY_LISTENING_VIEW, newestLine, shownLines, withFinal, withPartial } from "./line-store";

const speaker = () => "Speaker 1";

describe("the listening line store (#4100)", () => {
  it("shows the spoken line in grey, then replaces it with the final line", () => {
    let view = withPartial(EMPTY_LISTENING_VIEW, "microphone", "Okay, I'll put");
    view = withPartial(view, "microphone", "Okay, I'll put that in the brief");
    expect(shownLines(view, speaker)).toEqual([{ key: "live-microphone", speaker: "Speaker 1", text: "Okay, I'll put that in the brief", live: true }]);
    view = withFinal(view, [{ seq: 1, at: 1, speaker: "s1", text: "Okay, I'll put that in the brief." }], [{ key: "s1", label: "Speaker 1" }], "microphone");
    expect(shownLines(view, speaker)).toEqual([{ key: "seq-1", speaker: "Speaker 1", text: "Okay, I'll put that in the brief.", live: false }]);
    expect(newestLine(shownLines(view, speaker))?.text).toBe("Okay, I'll put that in the brief.");
  });

  it("keeps one line per seq, in order, and follows a renamed speaker", () => {
    let view = withFinal(EMPTY_LISTENING_VIEW, [{ seq: 2, at: 2, speaker: "s2", text: "Friday works." }], [{ key: "s2", label: "Speaker 2" }]);
    view = withFinal(view, [{ seq: 1, at: 1, speaker: "s1", text: "Can we ship?" }, { seq: 2, at: 2, speaker: "s2", text: "Friday works." }], [{ key: "s1", label: "Speaker 1" }]);
    expect(view.lines.map((line) => line.seq)).toEqual([1, 2]);
    view = withFinal(view, [], [{ key: "s1", label: "Ada" }]);
    expect(shownLines(view, speaker).map((line) => `${line.speaker}: ${line.text}`)).toEqual(["Ada: Can we ship?", "Speaker 2: Friday works."]);
  });

  it("answers the same view when nothing changed", () => {
    const view = withPartial(EMPTY_LISTENING_VIEW, "computer", "hello");
    expect(withPartial(view, "computer", "hello ")).toBe(view);
    expect(withFinal(view, [])).toBe(view);
  });
});
