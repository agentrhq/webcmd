import { defaultGitExec, setGitExecForTests } from './git-store.js';

export type GitIntercept = (
  args: readonly string[],
  runReal: () => Promise<{ stdout: string }>,
) => Promise<{ stdout: string }>;

export function restoreGitShim(): void {
  setGitExecForTests();
}

export function installGitShim(intercept: GitIntercept): { restore: () => void } {
  setGitExecForTests((file, args, options) => intercept(args, () => defaultGitExec(file, args, options)));
  return { restore: restoreGitShim };
}
