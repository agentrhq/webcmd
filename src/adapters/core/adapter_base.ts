import { StandardResult } from './result_schema.js';

/**
 * Base abstract class for all PC2 adapters.
 * Guarantees that any adapter implements run(input) -> Promise<StandardResult>.
 */
export abstract class AdapterBase<TInput = unknown, TOutput = Record<string, unknown>> {
  readonly adapterName?: string;

  /**
   * Primary entry point executing an adapter flow.
   *
   * @param input Typed input specific to the adapter action.
   * @returns Clean StandardResult matching the exact contract.
   */
  abstract run(input: TInput): Promise<StandardResult<TOutput>>;
}

/**
 * Interface representation of AdapterBase for callers preferring interface contracts.
 */
export interface IAdapterBase<TInput = unknown, TOutput = Record<string, unknown>> {
  readonly adapterName?: string;
  run(input: TInput): Promise<StandardResult<TOutput>>;
}
