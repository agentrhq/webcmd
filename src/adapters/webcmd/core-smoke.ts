import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { BrowserManager, type BrowserSession, type PageState } from '../core/browser_manager.js';
import {
  createSuccessResult,
  createFailureResult,
  type StandardResult,
} from '../core/result_schema.js';

export async function runCoreSmoke(
  browser = new BrowserManager(),
  url = 'https://example.com',
): Promise<StandardResult<PageState>> {
  let session: BrowserSession | undefined;

  try {
    session = await browser.startSession('pc2a-core-smoke');
    await browser.navigate(session, url);
    const pageState = await browser.readPage(session);

    return createSuccessResult<PageState>(
      'webcmd-core',
      'browser_smoke_test',
      pageState,
      'webcmd',
      { sessionId: session.id },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createFailureResult(
      'webcmd-core',
      'browser_smoke_test',
      'SMOKE_TEST_FAILED',
      message,
      'webcmd',
      error instanceof Error ? { name: error.name, message: error.message } : error,
    ) as unknown as StandardResult<PageState>;
  } finally {
    if (session) {
      await browser.closeSession(session).catch(() => {});
    }
  }
}

const isDirectExecution =
  process.argv[1] &&
  (path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase() ||
    process.argv[1].replace(/\\/g, '/').endsWith('core-smoke.ts'));

if (isDirectExecution) {
  runCoreSmoke()
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (!result.success) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      const errResult = createFailureResult(
        'webcmd-core',
        'browser_smoke_test',
        'UNHANDLED_ERROR',
        error instanceof Error ? error.message : String(error),
        'webcmd',
        error instanceof Error ? { name: error.name, message: error.message } : error,
      );
      console.log(JSON.stringify(errResult, null, 2));
      process.exitCode = 1;
    });
}
