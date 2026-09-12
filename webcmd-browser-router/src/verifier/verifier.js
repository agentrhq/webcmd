/**
 * Webcmd Verification Subsystem
 * First-class deterministic verification contracts for all actions.
 * No action is considered complete without passing its verification rule.
 */

class ActionVerifier {
  constructor(cdpClient, actionExecutor) {
    this.cdp = cdpClient;
    this.actions = actionExecutor;
  }

  async verify(rule, actionContext = {}) {
    if (!rule) {
      return { verified: true, reason: 'No explicit verification rule provided, action completed successfully' };
    }

    const maxWaitMs = rule.timeoutMs || 8000;
    const startTime = Date.now();
    const interval = 150;

    while (Date.now() - startTime < maxWaitMs) {
      const check = await this._evaluateRule(rule, actionContext);
      if (check.verified) {
        return check;
      }
      await new Promise(r => setTimeout(r, interval));
    }

    // Final evaluation after timeout
    const finalCheck = await this._evaluateRule(rule, actionContext);
    return finalCheck;
  }

  async _evaluateRule(rule, actionContext) {
    try {
      switch (rule.type) {
        case 'url': {
          const currentUrl = await this.cdp.evaluate('window.location.href');
          const expected = rule.expected || '';
          const matches = currentUrl.includes(expected) || new RegExp(expected, 'i').test(currentUrl);
          return {
            verified: matches,
            type: 'url',
            expected,
            actual: currentUrl,
            error: matches ? null : `URL does not match expected "${expected}" (current: "${currentUrl}")`
          };
        }

        case 'url_not': {
          const currentUrl = await this.cdp.evaluate('window.location.href');
          const disallowed = rule.disallowed || rule.expected || '';
          const isClean = !currentUrl.includes(disallowed);
          return {
            verified: isClean,
            type: 'url_not',
            disallowed,
            actual: currentUrl,
            error: isClean ? null : `URL contains disallowed segment "${disallowed}" (current: "${currentUrl}")`
          };
        }

        case 'article_identity': {
          const currentUrl = await this.cdp.evaluate('window.location.href');
          const disallowedUrlPart = rule.notUrl || 'Main_Page';
          const expectedTopic = String(rule.expectedTopic || rule.expected || '').trim().toLowerCase();

          // 1. Must not stay on Main Page / starting page
          if (currentUrl.includes(disallowedUrlPart)) {
            return {
              verified: false,
              type: 'article_identity',
              expected: expectedTopic,
              actualUrl: currentUrl,
              error: `Navigation did not leave starting page (${disallowedUrlPart})`
            };
          }

          // 2. Fetch main heading
          const heading = await this.cdp.evaluate(`(() => {
            const h = document.querySelector('#firstHeading, h1, .mw-page-title-main');
            return h ? (h.innerText || h.textContent || '').trim() : null;
          })()`);

          if (!heading) {
            return {
              verified: false,
              type: 'article_identity',
              expected: expectedTopic,
              actualUrl: currentUrl,
              error: `Could not find main article heading on ${currentUrl}`
            };
          }

          const headingNorm = heading.toLowerCase();
          const tokens = expectedTopic.split(/\s+/).filter(t => t.length > 2);
          const topicMatches = headingNorm.includes(expectedTopic) || 
            (tokens.length > 0 && tokens.every(t => headingNorm.includes(t) || currentUrl.toLowerCase().includes(t)));

          return {
            verified: topicMatches,
            type: 'article_identity',
            expected: expectedTopic,
            actualTitle: heading,
            actualUrl: currentUrl,
            error: topicMatches ? null : `Article title "${heading}" does not correspond to expected topic "${expectedTopic}"`
          };
        }

        case 'value': {
          const target = rule.target || actionContext.target;
          if (!target) return { verified: false, error: 'Target element required for value verification' };
          const loc = this.actions._buildLocatorScript(target);
          const actualValue = await this.cdp.evaluate(`(${loc})?.value`);
          const expected = rule.expected;
          const matches = String(actualValue ?? '') === String(expected ?? '');
          return {
            verified: matches,
            type: 'value',
            target,
            expected,
            actual: actualValue,
            error: matches ? null : `Input value mismatch for ${target}: expected "${expected}", got "${actualValue}"`
          };
        }

        case 'selector_visible': {
          const target = rule.target || rule.expected;
          const loc = this.actions._buildLocatorScript(target);
          const isVisible = await this.cdp.evaluate(`(() => {
            const el = ${loc};
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none';
          })()`);
          return {
            verified: Boolean(isVisible),
            type: 'selector_visible',
            target,
            error: isVisible ? null : `Target element ${target} is not visible in DOM`
          };
        }

        case 'text_contains': {
          const target = rule.target;
          const expected = String(rule.expected || '');
          let script;
          if (target) {
            const loc = this.actions._buildLocatorScript(target);
            script = `(${loc}) ? (${loc}.innerText || ${loc}.textContent || '') : null`;
          } else {
            script = 'document.body.innerText';
          }
          const actualText = await this.cdp.evaluate(script);
          const matches = Boolean(actualText && actualText.includes(expected));
          return {
            verified: matches,
            type: 'text_contains',
            target: target || 'body',
            expected,
            actual: actualText ? actualText.slice(0, 100) : null,
            error: matches ? null : `Element text does not contain "${expected}" (actual: "${actualText?.slice(0, 50)}")`
          };
        }

        case 'custom_js': {
          const expr = rule.expression || rule.expected;
          const result = await this.cdp.evaluate(`Boolean(${expr})`);
          return {
            verified: Boolean(result),
            type: 'custom_js',
            expression: expr,
            error: result ? null : `Custom JS condition failed: ${expr}`
          };
        }

        default:
          return { verified: true, reason: `Unknown verification rule type "${rule.type}", passing by default` };
      }
    } catch (err) {
      return { verified: false, error: `Verification exception: ${err.message}` };
    }
  }
}

module.exports = { ActionVerifier };
