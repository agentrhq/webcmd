"""
Universal Web QA Auditor
========================
A Playwright-based QA tool intended to work reasonably well on most
publicly-reachable websites (Streamlit apps, static sites, SPAs, etc.).

Honest scope note: no automated tool can catch *everything*. This will
not meaningfully test sites behind login walls, CAPTCHAs, canvas/WebGL-only
UIs, or native app wrappers. Treat its output as a strong first pass that
still deserves a human skim, not a certification.

Usage:
    python qa_tester.py --url https://example.com
    python qa_tester.py --url https://example.com --headless --skip-approval
    python qa_tester.py --url https://example.com --max-pages 3
"""

import argparse
import asyncio
import json
import re
from urllib.parse import urlparse

from playwright.async_api import async_playwright


# --------------------------------------------------------------------------
# Hackathon Hard Rule: Strict Human Approval Step
# --------------------------------------------------------------------------
def request_human_approval(action_name, skip=False):
    if skip:
        print(f"\n[AUTO-APPROVED, --skip-approval set] {action_name}")
        return True
    print(f"\n🚨 [ACTION REQUIRED] The agent is about to execute: {action_name}")
    choice = input("Proceed? (Y/N): ").strip().upper()
    return choice == 'Y'


# --------------------------------------------------------------------------
# Safety: never auto-click things that could trigger a real-world side
# effect on a live, unknown site (purchases, deletions, account changes...).
# --------------------------------------------------------------------------
DANGEROUS_KEYWORDS = [
    "delete", "remove", "buy", "purchase", "pay", "checkout", "subscribe",
    "unsubscribe", "cancel subscription", "logout", "log out", "sign out",
    "confirm", "submit order", "send payment", "close account",
    "deactivate", "transfer", "withdraw",
]

COOKIE_BANNER_TEXTS = [
    "accept all", "accept cookies", "i accept", "i agree", "agree",
    "got it", "allow all", "allow cookies", "ok", "continue",
]


def is_dangerous_label(label: str) -> bool:
    label_l = (label or "").lower()
    return any(kw in label_l for kw in DANGEROUS_KEYWORDS)


# --------------------------------------------------------------------------
# Dead-click / non-functional element detector
# --------------------------------------------------------------------------
class DeadClickDetector:
    """
    Flags clickable elements that produce no observable effect: no DOM
    change, no navigation, no network request, no dialog, no new tab.
    Skips anything matching DANGEROUS_KEYWORDS for safety.
    """

    CLICKABLE_SELECTOR = (
        "button, a, [role=button], [onclick], "
        "input[type=submit], input[type=button]"
    )

    def __init__(self, page):
        self.page = page
        self.request_count = 0
        self.console_errors = []
        self.dialog_seen = False
        page.on("request", self._on_request)
        page.on("console", self._on_console)
        page.on("dialog", self._on_dialog)

    def _on_request(self, request):
        self.request_count += 1

    def _on_console(self, msg):
        if msg.type == "error":
            self.console_errors.append(msg.text)

    def _on_dialog(self, dialog):
        self.dialog_seen = True
        asyncio.create_task(dialog.dismiss())

    async def _snapshot(self):
        return await self.page.evaluate(
            "document.body.innerText.length + '|' + document.body.innerHTML.length"
        )

    @staticmethod
    def _suggest_fix(tag, label):
        tag = (tag or "").lower()
        label = label or "(no visible label)"
        if tag == "a":
            return (
                f"Anchor '{label}' fired no navigation/network/DOM change. "
                f"Check for a placeholder href (e.g. href='#') or a JS "
                f"onclick handler that isn't actually wired up."
            )
        if tag == "button":
            return (
                f"Button '{label}' produced no effect. Verify its click "
                f"handler is actually attached/registered (e.g. in "
                f"Streamlit, that `if st.button(...):` result is checked, "
                f"or the on_click callback is assigned)."
            )
        return f"Clickable '{label}' (<{tag}>) had no observable effect. Verify a listener is bound."

    async def scan(self, max_elements=30, settle_ms=700):
        elements = self.page.locator(self.CLICKABLE_SELECTOR)
        count = await elements.count()
        base_url = self.page.url
        results, skipped = [], []

        for i in range(min(count, max_elements)):
            el = elements.nth(i)
            try:
                if not await el.is_visible() or not await el.is_enabled():
                    continue

                label = (
                    (await el.inner_text()).strip()
                    or (await el.get_attribute("aria-label") or "")
                    or (await el.get_attribute("title") or "")
                )
                tag = await el.evaluate("e => e.tagName")

                if is_dangerous_label(label):
                    skipped.append({"tag": tag, "label": label[:60], "reason": "matched dangerous-action keyword"})
                    continue

                before_snapshot = await self._snapshot()
                before_url, before_requests = self.page.url, self.request_count
                self.dialog_seen = False
                popup_task = asyncio.ensure_future(self.page.wait_for_event("popup", timeout=1500))

                try:
                    await el.click(timeout=3000, force=True)
                except Exception as click_err:
                    results.append({"tag": tag, "label": label[:60], "clickable": False, "error": str(click_err)})
                    popup_task.cancel()
                    continue

                await self.page.wait_for_timeout(settle_ms)
                popup = None
                try:
                    popup = await popup_task
                except Exception:
                    pass

                after_snapshot, after_url = await self._snapshot(), self.page.url
                dom_changed = after_snapshot != before_snapshot
                url_changed = after_url != before_url
                network_fired = self.request_count > before_requests
                opened_popup = popup is not None
                is_dead = not (dom_changed or url_changed or network_fired or self.dialog_seen or opened_popup)

                record = {
                    "tag": tag, "label": label[:60] or "(no visible label)", "clickable": True,
                    "dead": is_dead, "dom_changed": dom_changed, "url_changed": url_changed,
                    "network_fired": network_fired, "dialog_triggered": self.dialog_seen,
                    "popup_opened": opened_popup,
                }
                if is_dead:
                    record["suggested_fix"] = self._suggest_fix(tag, label)
                results.append(record)

                if url_changed or opened_popup:
                    if popup:
                        await popup.close()
                    if self.page.url != base_url:
                        await self.page.goto(base_url, wait_until="domcontentloaded")
                        await self.page.wait_for_timeout(800)

            except Exception as e:
                results.append({"index": i, "error": str(e)})

        return results, skipped


# --------------------------------------------------------------------------
# Auxiliary checks
# --------------------------------------------------------------------------
async def dismiss_cookie_banners(page):
    """Best-effort: click common consent-banner buttons so they don't block the scan."""
    for text in COOKIE_BANNER_TEXTS:
        try:
            btn = page.get_by_role("button", name=re.compile(text, re.I))
            if await btn.count() > 0 and await btn.first.is_visible():
                await btn.first.click(timeout=1500)
                await page.wait_for_timeout(400)
                return True
        except Exception:
            continue
    return False


async def check_broken_images(page):
    return await page.evaluate(
        """() => Array.from(document.images)
            .filter(img => img.src && img.naturalWidth === 0)
            .map(img => img.src)"""
    )


async def check_accessibility_basics(page):
    return await page.evaluate("""() => {
        const issues = [];
        document.querySelectorAll('img:not([alt])').forEach(img =>
            issues.push({type: 'missing_alt', src: img.src}));
        document.querySelectorAll('input, textarea, select').forEach(el => {
            const hasLabel = el.labels && el.labels.length > 0;
            const hasAria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
            if (!hasLabel && !hasAria && el.type !== 'hidden') {
                issues.push({type: 'unlabeled_input', name: el.name || el.id || '(unnamed)'});
            }
        });
        document.querySelectorAll('button, [role=button]').forEach(btn => {
            const text = btn.innerText.trim();
            const aria = btn.getAttribute('aria-label');
            if (!text && !aria) issues.push({type: 'unnamed_button', outerHTML: btn.outerHTML.slice(0,80)});
        });
        return issues;
    }""")


async def check_mixed_content(page):
    if not page.url.startswith("https://"):
        return []
    return await page.evaluate("""() => {
        const urls = [];
        document.querySelectorAll('img[src], script[src], link[href], iframe[src]').forEach(el => {
            const url = el.src || el.href;
            if (url && url.startsWith('http://')) urls.push(url);
        });
        return urls;
    }""")


def check_security_headers(response):
    headers = response.headers if response else {}
    checked = ["content-security-policy", "strict-transport-security", "x-frame-options", "x-content-type-options"]
    return {h: headers.get(h, "MISSING") for h in checked}


async def check_responsive(page, base_url):
    viewports = {"desktop": (1440, 900), "tablet": (768, 1024), "mobile": (375, 812)}
    results = {}
    for name, (w, h) in viewports.items():
        try:
            await page.set_viewport_size({"width": w, "height": h})
            await page.wait_for_timeout(500)
            overflow = await page.evaluate(
                "document.documentElement.scrollWidth > document.documentElement.clientWidth + 5"
            )
            results[name] = {"width": w, "horizontal_overflow": overflow}
        except Exception as e:
            results[name] = {"error": str(e)}
    await page.set_viewport_size({"width": 1440, "height": 900})
    return results


async def check_forms_non_destructive(page):
    """Inspects form validation WITHOUT ever calling submit() — never sends
    real data, never triggers real signups/payments/emails."""
    return await page.evaluate("""() => {
        return Array.from(document.forms).map(form => {
            const required = Array.from(form.querySelectorAll('[required]'));
            return {
                id: form.id || '(no id)',
                action: form.action || '(no action set)',
                method: form.method || 'get',
                field_count: form.elements.length,
                required_field_count: required.length,
                has_novalidate: form.hasAttribute('novalidate'),
            };
        });
    }""")


async def get_internal_links(page, base_url, limit=10):
    domain = urlparse(base_url).netloc
    hrefs = await page.locator("a").evaluate_all("els => els.map(e => e.href)")
    internal = []
    for h in hrefs:
        if h and urlparse(h).netloc == domain and h not in internal:
            internal.append(h)
    return internal[:limit]


# --------------------------------------------------------------------------
# Main audit routine (per page)
# --------------------------------------------------------------------------
async def audit_page(page, url, skip_approval, report):
    page_report = {"url": url}
    print(f"\n=== Auditing: {url} ===")

    response = None
    for wait_strategy in ("domcontentloaded", "load"):
        try:
            response = await page.goto(url, wait_until=wait_strategy, timeout=20000)
            break
        except Exception as e:
            print(f"  [WARN] navigation with wait_until={wait_strategy} failed: {e}")
    if response is None:
        page_report["error"] = "Page failed to load under any wait strategy."
        report["pages"].append(page_report)
        return

    await page.wait_for_timeout(2000)
    if await dismiss_cookie_banners(page):
        print("  Dismissed a cookie/consent banner.")

    page_report["http_status"] = response.status
    page_report["security_headers"] = check_security_headers(response)

    try:
        page_report["broken_images"] = await check_broken_images(page)
    except Exception as e:
        page_report["broken_images"] = f"error: {e}"

    try:
        page_report["accessibility_issues"] = await check_accessibility_basics(page)
    except Exception as e:
        page_report["accessibility_issues"] = f"error: {e}"

    try:
        page_report["mixed_content"] = await check_mixed_content(page)
    except Exception as e:
        page_report["mixed_content"] = f"error: {e}"

    try:
        page_report["forms"] = await check_forms_non_destructive(page)
    except Exception as e:
        page_report["forms"] = f"error: {e}"

    try:
        page_report["responsive"] = await check_responsive(page, url)
    except Exception as e:
        page_report["responsive"] = f"error: {e}"

    if request_human_approval(f"Scan clickable elements on {url} for dead clicks", skip_approval):
        try:
            detector = DeadClickDetector(page)
            results, skipped = await detector.scan()
            page_report["dead_click_results"] = results
            page_report["skipped_dangerous_elements"] = skipped
        except Exception as e:
            page_report["dead_click_results"] = f"error: {e}"
    else:
        print("  Dead-click scan skipped by operator.")

    report["pages"].append(page_report)


def render_markdown(report, screenshot_path=None):
    lines = ["# Universal QA Audit Report", f"**Base URL:** `{report['base_url']}`", ""]
    for pr in report["pages"]:
        lines.append(f"## Page: {pr['url']}")
        if "error" in pr:
            lines.append(f"⚠️ **Load failed:** {pr['error']}\n")
            continue
        lines.append(f"* **HTTP Status:** {pr.get('http_status')}")

        headers = pr.get("security_headers", {})
        missing = [h for h, v in headers.items() if v == "MISSING"]
        lines.append(f"* **Security headers missing:** {', '.join(missing) if missing else 'none'}")

        broken_imgs = pr.get("broken_images", [])
        lines.append(f"* **Broken images:** {len(broken_imgs) if isinstance(broken_imgs, list) else broken_imgs}")

        mixed = pr.get("mixed_content", [])
        lines.append(f"* **Mixed content (http on https):** {len(mixed) if isinstance(mixed, list) else mixed}")

        a11y = pr.get("accessibility_issues", [])
        lines.append(f"* **Accessibility issues found:** {len(a11y) if isinstance(a11y, list) else a11y}")

        resp = pr.get("responsive", {})
        overflow_devices = [d for d, v in resp.items() if isinstance(v, dict) and v.get("horizontal_overflow")]
        lines.append(f"* **Horizontal overflow on:** {', '.join(overflow_devices) if overflow_devices else 'none'}")

        forms = pr.get("forms", [])
        lines.append(f"* **Forms found:** {len(forms) if isinstance(forms, list) else forms}")

        dead = pr.get("dead_click_results")
        if isinstance(dead, list):
            dead_only = [d for d in dead if d.get("dead")]
            lines.append(f"* **Dead clickables:** {len(dead_only)} / {len(dead)} scanned")
            if dead_only:
                lines.append("\n| Tag | Label | Suggested Fix |\n|---|---|---|")
                for d in dead_only:
                    lines.append(f"| {d['tag']} | {d['label']} | {d.get('suggested_fix','')} |")
        skipped = pr.get("skipped_dangerous_elements", [])
        if skipped:
            lines.append(f"\n**Skipped for safety (needs manual review, not auto-clicked):**")
            for s in skipped:
                lines.append(f"- <{s['tag']}> \"{s['label']}\" ({s['reason']})")
        lines.append("")

    if screenshot_path:
        lines.append(f"## Proof of Execution\n![Screenshot]({screenshot_path})")
    return "\n".join(lines)


async def run_qa_tester(target_url, headless, max_pages, skip_approval):
    report = {"base_url": target_url, "pages": []}

    async with async_playwright() as p:
        print("Launching Playwright browser...")
        browser = await p.chromium.launch(headless=headless)
        page = await browser.new_page()

        try:
            urls_to_visit = [target_url]
            visited = set()
            screenshot_path = None

            while urls_to_visit and len(visited) < max_pages:
                url = urls_to_visit.pop(0)
                if url in visited:
                    continue
                visited.add(url)

                await audit_page(page, url, skip_approval, report)

                if len(visited) == 1 and request_human_approval("Capture full-page screenshot", skip_approval):
                    screenshot_path = "success_state.png"
                    try:
                        await page.screenshot(path=screenshot_path, full_page=True)
                        print(f"📸 Screenshot saved: {screenshot_path}")
                    except Exception as e:
                        print(f"  [WARN] screenshot failed: {e}")
                        screenshot_path = None

                if len(visited) < max_pages:
                    try:
                        more = await get_internal_links(page, target_url, limit=max_pages)
                        for link in more:
                            if link not in visited and link not in urls_to_visit:
                                urls_to_visit.append(link)
                    except Exception:
                        pass

            print("\nGenerating reports...")
            with open("qa_report.json", "w", encoding="utf-8") as f:
                json.dump(report, f, indent=2, default=str)
            with open("qa_report.md", "w", encoding="utf-8") as f:
                f.write(render_markdown(report, screenshot_path))
            print("✅ Reports exported: qa_report.md, qa_report.json")

        finally:
            await browser.close()
            print("Browser closed.")


def parse_args():
    parser = argparse.ArgumentParser(description="Universal Web QA Auditor")
    parser.add_argument(
        "--url",
        default="https://magical-bombolone-f9fbf8.netlify.app/#",
        help="Target URL to audit (default: the carbon footprint Streamlit app)"
    )
    parser.add_argument("--headless", action="store_true", help="Run browser headless (default: headed)")
    parser.add_argument("--max-pages", type=int, default=1, help="Max internal pages to crawl+audit (default: 1)")
    parser.add_argument("--skip-approval", action="store_true", help="Auto-approve all human-approval gates")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    asyncio.run(run_qa_tester(args.url, args.headless, args.max_pages, args.skip_approval))