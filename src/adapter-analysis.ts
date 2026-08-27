export interface AdapterAnalysisArg {
  name: string;
  positional?: boolean;
  required?: boolean;
  help?: string;
}

export interface AdapterAnalysisCommand {
  site: string;
  name: string;
  command: string;
  description?: string;
  access?: string;
  browser?: boolean;
  domain?: string | null;
  args?: readonly AdapterAnalysisArg[];
  columns?: readonly string[];
  pipeline?: readonly Record<string, unknown>[];
  runnable: boolean;
  sourceFile?: string;
  modulePath?: string;
}

export type AdapterAnalysisSourceReader = (logicalPath: string) => string | undefined;

export {
  validateAdapterCommands,
  type CommandValidationResult,
  type ValidationReport,
} from './validate.js';
export {
  auditAdapterConventions,
  type ConventionAuditReport,
  type ConventionViolation,
} from './convention-audit.js';
