import { describe, expect, it } from "vitest";

import { solveLinearProgram } from "./lp-simplex.ts";

describe("the simplex (#5014)", () => {
  it("solves a known program to its optimum", () => {
    // maximize 3x + 5y with x <= 4, 2y <= 12, 3x + 2y <= 18: optimum x = 2, y = 6, value 36
    const solution = solveLinearProgram({
      objective: [3, 5],
      constraints: [
        { coefficients: [1, 0], bound: 4 },
        { coefficients: [0, 2], bound: 12 },
        { coefficients: [3, 2], bound: 18 },
      ],
    });
    expect(solution.status).toBe("optimal");
    if (solution.status !== "optimal") return;
    expect(solution.values[0]).toBeCloseTo(2, 9);
    expect(solution.values[1]).toBeCloseTo(6, 9);
    expect(solution.value).toBeCloseTo(36, 9);
  });

  it("stays at the origin when nothing pays", () => {
    const solution = solveLinearProgram({ objective: [-1, 0], constraints: [{ coefficients: [1, 1], bound: 5 }] });
    expect(solution).toMatchObject({ status: "optimal", values: [0, 0], value: 0 });
  });

  it("says unbounded when a variable can grow without a limit", () => {
    expect(solveLinearProgram({ objective: [1, 1], constraints: [{ coefficients: [1, -1], bound: 2 }] }).status).toBe("unbounded");
  });

  it("refuses a negative bound (the origin must be feasible)", () => {
    expect(solveLinearProgram({ objective: [1], constraints: [{ coefficients: [1], bound: -1 }] }).status).toBe("infeasible");
  });

  it("ends on a degenerate program (Bland's rule never cycles)", () => {
    // Beale's classic cycling example, made feasible at the origin
    const solution = solveLinearProgram({
      objective: [0.75, -150, 0.02, -6],
      constraints: [
        { coefficients: [0.25, -60, -0.04, 9], bound: 0 },
        { coefficients: [0.5, -90, -0.02, 3], bound: 0 },
        { coefficients: [0, 0, 1, 0], bound: 1 },
      ],
    });
    expect(solution.status).toBe("optimal");
    if (solution.status === "optimal") expect(solution.value).toBeCloseTo(0.05, 6);
  });
});
