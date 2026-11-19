// #5014: a small linear program solver for the account planner
// (server/usage/account-planner.ts), with no dependency: the primal simplex
// on a dense tableau, Bland's rule against cycling.
//
//   maximize c·x  subject to  A x <= b,  x >= 0,  with b >= 0
//
// With every right-hand side non-negative the origin is feasible, so one
// phase is enough. The planner's programs are tiny (a few accounts times a
// few hours): a dense tableau is the simplest correct choice.

export interface LinearProgram {
  /** The objective's coefficient per variable (maximized). */
  objective: readonly number[];
  /** One row per constraint: coefficients per variable, and its bound. */
  constraints: ReadonlyArray<{ coefficients: readonly number[]; bound: number }>;
}

export type LinearSolution =
  | { status: "optimal"; values: number[]; value: number; iterations: number }
  | { status: "unbounded" | "infeasible" | "iterations"; iterations: number };

const EPSILON = 1e-9;

export function solveLinearProgram(program: LinearProgram, options: { maxIterations?: number } = {}): LinearSolution {
  const variables = program.objective.length;
  const rows = program.constraints.length;
  if (program.constraints.some((row) => row.bound < -EPSILON || !Number.isFinite(row.bound) || row.coefficients.length !== variables)) {
    return { status: "infeasible", iterations: 0 };
  }
  const width = variables + rows + 1;
  // the tableau: one row per constraint (its slack in column variables + i), then the objective row
  const tableau: number[][] = program.constraints.map((row, index) => {
    const line = Array.from({ length: width }, () => 0);
    row.coefficients.forEach((value, column) => { line[column] = value; });
    line[variables + index] = 1;
    line[width - 1] = Math.max(0, row.bound);
    return line;
  });
  const goal = Array.from({ length: width }, () => 0);
  program.objective.forEach((value, column) => { goal[column] = -value; });
  tableau.push(goal);
  const basis = Array.from({ length: rows }, (_, index) => variables + index);
  const maxIterations = options.maxIterations ?? 50 * (variables + rows + 1);
  let iterations = 0;
  for (;;) {
    // Bland: the lowest-index column that improves the objective
    let entering = -1;
    for (let column = 0; column < width - 1; column++) {
      if (goal[column]! < -EPSILON) { entering = column; break; }
    }
    if (entering < 0) break;
    if (iterations >= maxIterations) return { status: "iterations", iterations };
    iterations++;
    // the ratio test, ties to the lowest basic index (Bland)
    let leaving = -1;
    let best = Infinity;
    for (let row = 0; row < rows; row++) {
      const value = tableau[row]![entering]!;
      if (value <= EPSILON) continue;
      const ratio = tableau[row]![width - 1]! / value;
      if (ratio < best - EPSILON || (Math.abs(ratio - best) <= EPSILON && leaving >= 0 && basis[row]! < basis[leaving]!)) {
        best = ratio;
        leaving = row;
      }
    }
    if (leaving < 0) return { status: "unbounded", iterations };
    const pivot = tableau[leaving]!;
    const scale = pivot[entering]!;
    for (let column = 0; column < width; column++) pivot[column]! /= scale;
    for (let row = 0; row <= rows; row++) {
      if (row === leaving) continue;
      const line = tableau[row]!;
      const factor = line[entering]!;
      if (Math.abs(factor) <= EPSILON) continue;
      for (let column = 0; column < width; column++) line[column]! -= factor * pivot[column]!;
    }
    basis[leaving] = entering;
  }
  const values = Array.from({ length: variables }, () => 0);
  basis.forEach((column, row) => {
    if (column < variables) values[column] = Math.max(0, tableau[row]![width - 1]!);
  });
  const value = values.reduce((sum, x, column) => sum + x * program.objective[column]!, 0);
  return { status: "optimal", values, value, iterations };
}
