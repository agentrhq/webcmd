import type { StandardResult } from './result_schema';

export interface AdapterInput {
  action: string;
  [key: string]: unknown;
}

export abstract class AdapterBase<TInput extends AdapterInput = AdapterInput, TData = unknown> {
  public abstract readonly adapter: string;

  public abstract run(input: TInput): Promise<StandardResult<TData>>;
}
