import { vi } from 'vitest';

export function createPageMock(evaluateResults = []) {
  const evaluate = vi.fn();
  for (const result of evaluateResults) evaluate.mockResolvedValueOnce(result);
  return {
    evaluate,
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
  };
}
