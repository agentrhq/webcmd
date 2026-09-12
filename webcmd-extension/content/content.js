/**
 * Webcmd In-Page Content Script
 * Scans active DOM, extracts interactive elements, tags them with @eN references,
 * and renders glowing visual badge overlays on the live webpage.
 */

(() => {
  let activeBadges = [];
  let highlightedElements = [];
  let tooltipBox = null;

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
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
    return tag;
  }

  function getDirectText(el) {
    return (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim();
  }

  function scanInteractiveElements() {
    const allNodes = document.querySelectorAll('*');
    const interactive = [];
    let count = 1;

    for (const el of allNodes) {
      if (!isVisible(el)) continue;

      const tag = el.tagName.toLowerCase();
      const role = getRole(el);
      const isInteractive = (
        ['button', 'a', 'input', 'select', 'textarea'].includes(tag) ||
        ['button', 'link', 'textbox', 'combobox', 'searchbox', 'checkbox', 'radio'].includes(role) ||
        el.hasAttribute('onclick') ||
        el.getAttribute('tabindex') === '0'
      );

      if (isInteractive) {
        const ref = `@e${count++}`;
        const rect = el.getBoundingClientRect();
        const attrs = getCleanAttributes(el);
        const text = getDirectText(el).slice(0, 40);

        interactive.push({
          ref,
          tag,
          role,
          text,
          attributes: attrs,
          rect: {
            top: rect.top + window.scrollY,
            left: rect.left + window.scrollX,
            width: rect.width,
            height: rect.height
          },
          element: el
        });

        if (count > 60) break; // Keep perception fast and bounded
      }
    }

    return interactive;
  }

  function removeOverlays() {
    activeBadges.forEach(b => b.remove());
    activeBadges = [];
    highlightedElements.forEach(el => el.classList.remove('webcmd-highlighted-element'));
    highlightedElements = [];
    if (tooltipBox) {
      tooltipBox.remove();
      tooltipBox = null;
    }
  }

  function drawOverlays() {
    removeOverlays();
    const elements = scanInteractiveElements();

    elements.forEach(item => {
      const el = item.element;
      el.classList.add('webcmd-highlighted-element');
      highlightedElements.push(el);

      const badge = document.createElement('div');
      badge.className = 'webcmd-badge-tag';
      badge.style.top = `${Math.max(0, item.rect.top - 12)}px`;
      badge.style.left = `${Math.max(0, item.rect.left + 2)}px`;
      badge.innerHTML = `<span>${item.ref}</span><span class="webcmd-badge-role">${item.role}</span>`;

      badge.addEventListener('mouseenter', () => {
        showTooltip(item);
      });

      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(item.ref);
        badge.innerHTML = `<span>${item.ref}</span><span class="webcmd-badge-role">COPIED!</span>`;
        setTimeout(() => {
          badge.innerHTML = `<span>${item.ref}</span><span class="webcmd-badge-role">${item.role}</span>`;
        }, 1200);
      });

      document.body.appendChild(badge);
      activeBadges.push(badge);
    });

    return elements.map(e => ({
      ref: e.ref,
      tag: e.tag,
      role: e.role,
      text: e.text,
      attributes: e.attributes
    }));
  }

  function showTooltip(item) {
    if (!tooltipBox) {
      tooltipBox = document.createElement('div');
      tooltipBox.className = 'webcmd-tooltip-box';
      document.body.appendChild(tooltipBox);
    }

    const idStr = item.attributes.id ? `#${item.attributes.id}` : '';
    const classStr = item.attributes.class ? `.${item.attributes.class.split(' ').slice(0, 2).join('.')}` : '';

    tooltipBox.innerHTML = `
      <div class="webcmd-tooltip-header">
        <span>${item.ref} (${item.role.toUpperCase()})</span>
        <span style="font-size: 10px; color: #a78bfa;">Scrapling Fingerprint</span>
      </div>
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #38bdf8; margin-bottom: 4px;">
        &lt;${item.tag}${idStr}${classStr}&gt;
      </div>
      <div style="color: #94a3b8; font-size: 11px;">
        Text: <span style="color: #f1f5f9;">"${item.text || '(empty)'}"</span>
      </div>
      <div style="color: #64748b; font-size: 10px; margin-top: 6px;">
        Click badge to copy reference to clipboard
      </div>
    `;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'DRAW_OVERLAYS') {
      const elements = drawOverlays();
      sendResponse({ success: true, count: elements.length, elements });
    } else if (msg.type === 'REMOVE_OVERLAYS') {
      removeOverlays();
      sendResponse({ success: true });
    }
    return true;
  });
})();
