/**
 * Injected script for interactive fuzzing (clicking elements to trigger lazy loading)
 */
export async function interactFuzz() {
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const clickables = Array.from(document.querySelectorAll(
    'button, [role="button"], [role="tab"], .tab, .btn, a[href="javascript:void(0)"], a[href="#"]'
  )).slice(0, 15); // limit to a small number to avoid endless loops

  let clicked = 0;
  for (const el of clickables) {
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        clicked++;
        await sleep(300); // give it time to trigger network
      }
    } catch {}
  }
  return clicked;
}
