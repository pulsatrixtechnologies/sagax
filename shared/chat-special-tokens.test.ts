import { describe, expect, it } from "vitest";
import { ChatSpecialTokenStream, stripChatSpecialTokens } from "./chat-special-tokens.ts";

const streamed = (...deltas: string[]) => {
  const stream = new ChatSpecialTokenStream();
  return deltas.map((delta) => stream.feed(delta)).join("") + stream.finish();
};

describe("stripChatSpecialTokens", () => {
  it.each(["<|eos|>", "<|endoftext|>", "<|im_end|>", "<|eot_id|>", "<|end|>", "</s>", "<eos>", "<|end_of_text|>", "<end_of_turn>", " <|eos|>\n<|im_end|> "])(
    "makes a reply of only %j empty", (token) => expect(stripChatSpecialTokens(token)).toBe(""));

  it("drops tokens at the start and end", () => {
    expect(stripChatSpecialTokens("<|im_start|>assistant\nHello.<|im_end|>")).toBe("Hello.");
    expect(stripChatSpecialTokens("<s> Hi there </s>")).toBe("Hi there");
    expect(stripChatSpecialTokens("Done.<|END_OF_TURN_TOKEN|>")).toBe("Done.");
  });

  it("keeps a token quoted mid-sentence and ordinary markup", () => {
    expect(stripChatSpecialTokens("The <|eos|> token ends a turn.")).toBe("The <|eos|> token ends a turn.");
    expect(stripChatSpecialTokens("a <b> tag and x < y")).toBe("a <b> tag and x < y");
    expect(stripChatSpecialTokens("  untouched  ")).toBe("  untouched  ");
  });

  it("leaves a token inside a code block as written", () => {
    const block = "Le jeton de fin :\n```\n<|eos|>\n```";
    expect(stripChatSpecialTokens(block)).toBe(block);
    expect(stripChatSpecialTokens("```text\nfin <|im_end|>\n```<|eos|>")).toBe("```text\nfin <|im_end|>\n```");
  });
});

describe("ChatSpecialTokenStream", () => {
  it("never shows a token split across deltas", () => {
    expect(streamed("Bonjour.", "<|", "eo", "s|>")).toBe("Bonjour.");
    expect(streamed("Bonjour.", "</", "s>")).toBe("Bonjour.");
  });

  it("shows nothing for a reply that is only a token", () => {
    expect(streamed("<|eos|>")).toBe("");
    expect(streamed("<|e", "os|>", "\n")).toBe("");
  });

  it("drops a leading role header", () => {
    expect(streamed("<|im_start|>", "assist", "ant\nHi.", "<|im_end|>")).toBe("Hi.");
  });

  it("lets a quoted token through once the sentence goes on", () => {
    expect(streamed("The ", "<|eos|>", " token.")).toBe("The <|eos|> token.");
    expect(streamed("x <", " y")).toBe("x < y");
    expect(streamed("x <")).toBe("x <");
  });
});
