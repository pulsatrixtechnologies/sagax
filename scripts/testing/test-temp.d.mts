export const TEST_TEMP_PREFIX: string;
export function testTempParent(root?: string): string;
export function pruneTestTemps(root?: string, now?: number, maxAgeMs?: number): number;
export function createTestTempRoot(root?: string): { path: string; cleanup(): void };
