import type {
  AnonymizedSide,
  BlindPairTask,
  Criterion,
  CriterionGap,
  TaskExpect,
} from "./types.ts";

/** Deterministic fixture judge. Rules only: no model, no network. Each
 * criterion is scored independently so the report can list gaps without a
 * single rolled-up score (#2644 protocol). */

function wordCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

function looksFrench(text: string): boolean {
  return /\b(bonjour|oui|non|reponse|réponse|merci|svp|s'il|vous|avec|la|le|les|est)\b/i.test(text)
    || /[àâäéèêëïîôùûüç]/i.test(text);
}

function looksEnglish(text: string): boolean {
  return /\b(hello|yes|no|the|and|with|answer|ready|done|sure|here|open|check|close|status|count)\b/i.test(text);
}

function matchesFormat(text: string, format: NonNullable<TaskExpect["format"]>): boolean {
  const trimmed = text.trim();
  switch (format) {
    case "plain":
      return trimmed.length > 0 && !trimmed.startsWith("{") && !/^\d+\.\s/m.test(trimmed);
    case "numbered-list":
      return /^\s*\d+\.\s+\S+/m.test(trimmed);
    case "json-object":
      try {
        const value = JSON.parse(trimmed);
        return value !== null && typeof value === "object" && !Array.isArray(value);
      } catch {
        return false;
      }
    case "one-word":
      return /^\S+$/.test(trimmed);
    default:
      return false;
  }
}

function looksLikeRefusal(text: string): boolean {
  return /\b(refus(e|ed|al)?|cannot|can't|will not|won't|out of scope|outside my scope)\b/i.test(text);
}

function scoreSide(side: AnonymizedSide, expect: TaskExpect, criterion: Criterion): "pass" | "fail" | "n/a" {
  switch (criterion) {
    case "exactness": {
      if (expect.mustContain.length === 0 && expect.mustNotContain.length === 0) return "n/a";
      const hasAll = expect.mustContain.every((needle) => side.text.includes(needle));
      const hasNone = expect.mustNotContain.every((needle) => !side.text.includes(needle));
      return hasAll && hasNone ? "pass" : "fail";
    }
    case "completeness": {
      if (expect.mustContain.length === 0) return "n/a";
      const hits = expect.mustContain.filter((needle) => side.text.includes(needle)).length;
      return hits === expect.mustContain.length ? "pass" : "fail";
    }
    case "language": {
      if (expect.language === undefined) return "n/a";
      if (expect.language === "fr") {
        return looksFrench(side.text) && !looksEnglish(side.text) ? "pass" : "fail";
      }
      // English: require an English cue and no French cue.
      return looksEnglish(side.text) && !looksFrench(side.text) ? "pass" : "fail";
    }
    case "format": {
      if (expect.format === undefined) return "n/a";
      return matchesFormat(side.text, expect.format) ? "pass" : "fail";
    }
    case "length": {
      if (expect.maxWords === undefined) return "n/a";
      return wordCount(side.text) <= expect.maxWords ? "pass" : "fail";
    }
    case "latency": {
      if (expect.usefulWithinMs === undefined) return "n/a";
      return side.latencyMs <= expect.usefulWithinMs ? "pass" : "fail";
    }
    case "refusal": {
      if (!expect.refuse) return "n/a";
      return looksLikeRefusal(side.text) ? "pass" : "fail";
    }
    default:
      return "n/a";
  }
}

function detailFor(
  criterion: Criterion,
  a: "pass" | "fail" | "n/a",
  b: "pass" | "fail" | "n/a",
  sideA: AnonymizedSide,
  sideB: AnonymizedSide,
  expect: TaskExpect,
): string {
  if (a === "n/a" && b === "n/a") return "criterion not in play for this task";
  if (criterion === "latency") {
    return "A " + sideA.latencyMs + "ms, B " + sideB.latencyMs + "ms"
      + (expect.usefulWithinMs === undefined ? "" : ", ceiling " + expect.usefulWithinMs + "ms");
  }
  if (criterion === "length") {
    return "A " + wordCount(sideA.text) + " words, B " + wordCount(sideB.text) + " words"
      + (expect.maxWords === undefined ? "" : ", max " + expect.maxWords);
  }
  if (a === b) return "both " + a;
  return "A " + a + ", B " + b;
}

/** Criteria the family cares about. Others stay n/a so the report stays
 * focused on the sitting's question. */
export function criteriaForFamily(family: BlindPairTask["family"]): Criterion[] {
  switch (family) {
    case "P-1":
      return ["exactness", "completeness"];
    case "P-2":
      return ["language", "format", "length"];
    case "P-3":
      return ["latency", "exactness"];
    case "P-4":
      return ["refusal", "exactness"];
    default:
      return [];
  }
}

export function judgePair(
  task: BlindPairTask,
  sideA: AnonymizedSide,
  sideB: AnonymizedSide,
): CriterionGap[] {
  const gaps: CriterionGap[] = [];
  for (const criterion of criteriaForFamily(task.family)) {
    const a = scoreSide(sideA, task.expect, criterion);
    const b = scoreSide(sideB, task.expect, criterion);
    gaps.push({
      criterion,
      assistantA: a,
      assistantB: b,
      detail: detailFor(criterion, a, b, sideA, sideB, task.expect),
    });
  }
  return gaps;
}
