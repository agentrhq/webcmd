/**
 * Webcmd Snapshot & Perception Subsystem
 * Generates compact accessibility & DOM snapshots with stable @eN references.
 * Extracts structural fingerprints for Scrapling adaptive recovery.
 */

const INJECTED_SNAPSHOT_SCRIPT = `(() => {
  const INTERACTIVE_TAGS = new Set(['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'OPTION', 'DETAILS', 'SUMMARY']);
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'listbox',
    'menuitem', 'option', 'searchbox', 'switch', 'tab', 'treeitem'
  ]);

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function getPath(el) {
    const path = [];
    let curr = el;
    while (curr && curr.nodeType === 1) {
      path.unshift(curr.tagName.toLowerCase());
      curr = curr.parentElement;
    }
    return path;
  }

  function getCleanAttributes(el) {
    const attrs = {};
    for (const attr of el.attributes) {
      if (['id', 'class', 'name', 'type', 'placeholder', 'role', 'aria-label', 'href', 'title', 'data-testid', 'data-product', 'value'].includes(attr.name)) {
        if (attr.value && attr.value.trim()) {
          attrs[attr.name] = attr.value.trim();
        }
      }
    }
    return attrs;
  }

  function getRole(el) {
    const explicitRole = el.getAttribute('role');
    if (explicitRole) return explicitRole.toLowerCase();
    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (['button', 'submit', 'reset'].includes(type)) return 'button';
      if (['checkbox', 'radio'].includes(type)) return type;
      return 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') return 'heading';
    return tag;
  }

  function getDirectText(el) {
    let text = '';
    for (const child of el.childNodes) {
      if (child.nodeType === 3) { // Text node
        text += ' ' + child.nodeValue.trim();
      }
    }
    return text.trim() || el.innerText?.trim() || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
  }

  const elements = [];
  let refCount = 1;

  // Walk through DOM
  const allNodes = document.querySelectorAll('*');
  for (const el of allNodes) {
    if (!isVisible(el)) continue;

    const tag = el.tagName.toLowerCase();
    const role = getRole(el);
    const isInteractive = INTERACTIVE_TAGS.has(el.tagName) || INTERACTIVE_ROLES.has(role) || el.hasAttribute('onclick') || el.hasAttribute('tabindex');

    // Only assign refs to interactive elements or key landmarks
    const isLandmark = ['heading', 'main', 'nav', 'form'].includes(role) || ['h1', 'h2', 'h3', 'form'].includes(tag);

    if (isInteractive || isLandmark) {
      const ref = '@e' + (refCount++);
      el.setAttribute('data-webcmd-ref', ref);

      const parent = el.parentElement;
      const siblings = parent ? Array.from(parent.children).filter(c => c !== el).map(c => c.tagName.toLowerCase()) : [];
      const children = Array.from(el.children).map(c => c.tagName.toLowerCase());

      const fingerprint = {
        tag,
        role,
        text: getDirectText(el),
        attributes: getCleanAttributes(el),
        path: getPath(el),
        parent_name: parent ? parent.tagName.toLowerCase() : null,
        parent_attribs: parent ? getCleanAttributes(parent) : {},
        parent_text: parent ? getDirectText(parent).slice(0, 100) : null,
        siblings,
        children
      };

      const value = (tag === 'input' || tag === 'textarea' || tag === 'select') ? el.value : null;

      elements.push({
        ref,
        tag,
        role,
        text: fingerprint.text,
        attributes: fingerprint.attributes,
        value,
        isInteractive,
        fingerprint
      });
    }
  }

  return {
    title: document.title,
    url: window.location.href,
    elements
  };
})()`;

class SnapshotEngine {
  constructor(cdpClient) {
    this.cdp = cdpClient;
    this.lastSnapshot = null;
    this.refMap = new Map();
  }

  async capture(options = {}) {
    const rawData = await this.cdp.evaluate(INJECTED_SNAPSHOT_SCRIPT);
    this.lastSnapshot = rawData;
    this.refMap.clear();

    for (const el of rawData.elements) {
      this.refMap.set(el.ref, el);
    }

    return this.format(rawData, options);
  }

  format(snapshotData, options = {}) {
    const interactiveOnly = options.interactive !== false;
    const lines = [];

    lines.push(`Page: ${snapshotData.title || '(Untitled)'}`);
    lines.push(`URL: ${snapshotData.url}`);
    lines.push('');

    for (const el of snapshotData.elements) {
      if (interactiveOnly && !el.isInteractive) continue;

      let descriptor = `${el.ref} [${el.role}]`;
      if (el.text) {
        descriptor += ` "${el.text.slice(0, 50)}"`;
      }
      if (el.attributes.placeholder) {
        descriptor += ` placeholder="${el.attributes.placeholder}"`;
      }
      if (el.attributes.id) {
        descriptor += ` id="${el.attributes.id}"`;
      }
      if (el.attributes.type && el.attributes.type !== 'text') {
        descriptor += ` type="${el.attributes.type}"`;
      }
      if (el.value !== null && el.value !== undefined && el.value !== '') {
        descriptor += ` value="${el.value}"`;
      }

      lines.push(descriptor);
    }

    return {
      text: lines.join('\n'),
      data: snapshotData
    };
  }

  getElementByRef(ref) {
    return this.refMap.get(ref);
  }

  getAllFingerprints() {
    return Array.from(this.refMap.values()).map(el => el.fingerprint);
  }
}

module.exports = { SnapshotEngine, INJECTED_SNAPSHOT_SCRIPT };
