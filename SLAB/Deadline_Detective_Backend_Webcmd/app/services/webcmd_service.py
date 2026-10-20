import asyncio
import json
import subprocess
import shlex
from typing import List, Dict, Any, Optional
from app.config import get_settings


class WebcmdService:
    """
    Service that controls the browser through Webcmd CLI.
    Replaces the old Playwright service.
    """

    def __init__(self):
        self.settings = get_settings()
        self.profile = self.settings.webcmd_profile
        self.session_id: Optional[str] = None

    def _run_cmd(self, args: List[str], input_text: str = None, timeout: int = 60) -> Dict[str, Any]:
        """Run a webcmd command and return parsed JSON when possible."""
        webcmd_path = __import__('shutil').which('webcmd') or 'webcmd'
        cmd = [webcmd_path, "--profile", self.profile] + args

        try:
            result = subprocess.run(
                cmd,
                input=input_text,
                capture_output=True,
                text=True,
                timeout=timeout,
            )

            stdout = result.stdout.strip()
            stderr = result.stderr.strip()

            if result.returncode != 0:
                return {
                    "success": False,
                    "error": stderr or stdout or "Webcmd command failed",
                    "raw": stdout
                }

            # Try to parse JSON
            try:
                data = json.loads(stdout)
                return {"success": True, "data": data, "raw": stdout}
            except json.JSONDecodeError:
                return {"success": True, "data": stdout, "raw": stdout}

        except subprocess.TimeoutExpired:
            return {"success": False, "error": "Webcmd command timed out"}
        except FileNotFoundError:
            return {
                "success": False,
                "error": "webcmd command not found. Please install it: npm install -g @agentrhq/webcmd"
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def start_session(self, name: str = "DeadlineDetective") -> bool:
        """Create a new Webcmd browser session."""
        result = self._run_cmd(["session", "create", name, "-f", "json"])

        if not result["success"]:
            print(f"[Webcmd] Failed to create session: {result.get('error')}")
            return False

        data = result.get("data")
        if isinstance(data, dict):
            self.session_id = data.get("id") or data.get("session_id") or data.get("session")
        elif isinstance(data, str):
            # Sometimes the ID is printed as plain text
            self.session_id = data.strip()

        if not self.session_id:
            # Fallback: try to extract from raw output
            raw = result.get("raw", "")
            for line in raw.splitlines():
                if "id:" in line.lower():
                    self.session_id = line.split(":")[-1].strip()
                    break

        print(f"[Webcmd] Session started: {self.session_id}")
        return bool(self.session_id)

    async def close_session(self):
        """Close the current Webcmd session."""
        if not self.session_id:
            return

        self._run_cmd(["session", "close", self.session_id])
        print(f"[Webcmd] Session closed: {self.session_id}")
        self.session_id = None

    async def run_browser_js(self, js_code: str, timeout: int = 45) -> Dict[str, Any]:
        """
        Execute a Playwright-style JavaScript program inside the Webcmd session.
        """
        if not self.session_id:
            return {"success": False, "error": "No active Webcmd session"}

        args = [
            "--session", self.session_id,
            "browser", "run",
            "--stdin",
            "--no-snapshot-diff",
            "--timeout", str(timeout),
            "-f", "json"
        ]

        result = self._run_cmd(args, input_text=js_code, timeout=timeout + 10)
        return result

    async def visit_and_extract(self, url: str) -> Dict[str, Any]:
        """Visit a URL and extract title + readable text."""
        js_code = f"""
await page.goto('{url}', {{ waitUntil: 'domcontentloaded', timeout: 30000 }});
await page.waitForTimeout(1500);

const title = await page.title();
const text = await page.innerText('body');

return {{
  url: page.url(),
  title: title,
  text: text.slice(0, 10000)
}};
"""
        result = await self.run_browser_js(js_code)

        if not result["success"]:
            return {
                "url": url,
                "title": "",
                "text": "",
                "success": False,
                "error": result.get("error", "Failed to extract")
            }

        data = result.get("data")
        if isinstance(data, dict):
            # Webcmd sometimes wraps the return value
            content = data.get("result") or data.get("data") or data
            if isinstance(content, dict):
                return {
                    "url": content.get("url", url),
                    "title": content.get("title", ""),
                    "text": content.get("text", ""),
                    "success": True,
                    "error": None
                }

        return {
            "url": url,
            "title": "",
            "text": str(data)[:5000] if data else "",
            "success": True,
            "error": None
        }

    async def search_and_collect(self, plan: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Execute the research plan using Webcmd.
        Visits target sites + does simple searches.
        """
        if not await self.start_session("DeadlineDetective"):
            return []

        all_urls = set()

        # Add target sites from plan
        for site in plan.get("target_sites", [])[:4]:
            if isinstance(site, str) and site.startswith("http"):
                all_urls.add(site)

        # Simple search via DuckDuckGo using browser
        for query in plan.get("search_queries", [])[:2]:
            try:
                search_js = f"""
await page.goto('https://duckduckgo.com/?q={query.replace(" ", "+")}', {{ waitUntil: 'domcontentloaded' }});
await page.waitForTimeout(2000);

const links = await page.$$eval('a[data-testid="result-title-a"], a.result__a', els => 
  els.slice(0, 3).map(a => a.href).filter(h => h && h.startsWith('http'))
);
return {{ links }};
"""
                search_result = await self.run_browser_js(search_js)
                if search_result["success"]:
                    data = search_result.get("data")
                    if isinstance(data, dict):
                        content = data.get("result") or data.get("data") or data
                        links = content.get("links", []) if isinstance(content, dict) else []
                        for link in links:
                            all_urls.add(link)
            except Exception as e:
                print(f"[Webcmd] Search failed for '{query}': {e}")

        urls_to_visit = list(all_urls)[: self.settings.max_pages]
        results = []

        for url in urls_to_visit:
            print(f"[Webcmd] Visiting: {url}")
            page_data = await self.visit_and_extract(url)
            if page_data.get("success") and len(page_data.get("text", "")) > 80:
                results.append(page_data)
            await asyncio.sleep(1)

        await self.close_session()
        return results
