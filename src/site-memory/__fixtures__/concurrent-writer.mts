/**
 * Child process for the cross-process site memory tests. Run through tsx:
 *
 *   node <tsx-cli> concurrent-writer.mts <homeDir> <site> note|endpoint <label> <count>
 *
 * Each run writes `count` times so several of these racing against one another
 * interleave inside the read-modify-write window rather than only at startup.
 */
import { appendNote, setEndpoint } from '../local-store.js';

const [homeDir, site, mode, label, count] = process.argv.slice(2);

for (let index = 0; index < Number(count); index += 1) {
  const name = `${mode}-${label}-${index}`;
  if (mode === 'endpoint') {
    await setEndpoint({ site, homeDir, name, url: `https://${site}/api/${name}`, method: 'GET' });
  } else {
    await appendNote({ site, homeDir, text: name });
  }
}
