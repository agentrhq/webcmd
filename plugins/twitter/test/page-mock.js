import { vi } from 'vitest';

export function createPageMock(evaluateResults = [], overrides = {}) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) evaluate.mockResolvedValueOnce(result);
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate,
        wait: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}
