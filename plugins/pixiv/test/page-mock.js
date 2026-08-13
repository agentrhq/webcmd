import { vi } from 'vitest';

export function createPageMock(evaluateResults = [], overrides = {}) {
  const evaluate = vi.fn();
  for (const result of evaluateResults) evaluate.mockResolvedValueOnce(result);
  return {
    evaluate,
    getCookies: vi.fn().mockResolvedValue([]),
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
