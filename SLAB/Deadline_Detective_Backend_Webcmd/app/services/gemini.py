from google import genai
from google.genai import types
from app.config import get_settings
from app.models import StudentProfile, Opportunity
from typing import List, Dict, Any
import json
import re
import time


class GeminiService:
    def __init__(self):
        settings = get_settings()
        self.client = genai.Client(api_key=settings.gemini_api_key)
        self.model = "gemini-2.5-flash"

    def _extract_json(self, text: str) -> Any:
        """Extract JSON from Gemini response (handles markdown code blocks)."""
        text = text.strip()
        # Try to find JSON inside ```json ... ```
        match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
        if match:
            text = match.group(1).strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # Try to find first { ... } or [ ... ]
            start = text.find("{")
            end = text.rfind("}") + 1
            if start != -1 and end > start:
                try:
                    return json.loads(text[start:end])
                except json.JSONDecodeError:
                    pass
            # Try array
            start = text.find("[")
            end = text.rfind("]") + 1
            if start != -1 and end > start:
                try:
                    return json.loads(text[start:end])
                except json.JSONDecodeError:
                    pass
            raise

    def _generate_with_retry(self, prompt: str, max_tokens: int, temperature: float = 0.2, retries: int = 2) -> Any:
        """Call Gemini with retry logic for transient failures and JSON parsing."""
        last_error = None
        for attempt in range(retries + 1):
            try:
                response = self.client.models.generate_content(
                    model=self.model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=temperature,
                        max_output_tokens=max_tokens,
                    )
                )
                return self._extract_json(response.text)
            except (json.JSONDecodeError, Exception) as e:
                last_error = e
                print(f"[Gemini] Attempt {attempt + 1} failed: {e}")
                if attempt < retries:
                    time.sleep(1.5 * (attempt + 1))
        # If all retries failed, try once more without response_mime_type
        try:
            print("[Gemini] Trying without response_mime_type constraint...")
            response = self.client.models.generate_content(
                model=self.model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=temperature,
                    max_output_tokens=max_tokens,
                )
            )
            return self._extract_json(response.text)
        except Exception as e:
            print(f"[Gemini] Final fallback also failed: {e}")
            raise last_error or e

    def create_research_plan(self, task: str, profile: StudentProfile | None) -> Dict[str, Any]:
        profile_text = "No specific profile provided."
        if profile:
            profile_text = (
                f"Year: {profile.year or 'Not specified'}\n"
                f"Branch: {profile.branch or 'Not specified'}\n"
                f"Interests: {profile.interests or 'Not specified'}\n"
                f"Location: {profile.location or 'India'}"
            )

        prompt = f"""
You are an expert research planner for college students in India.

Student Profile:
{profile_text}

User Task:
{task}

Create a focused research plan to find currently open opportunities (hackathons, internships, scholarships, competitions, college events).

Return ONLY valid JSON in this exact format:
{{
  "search_queries": ["query1", "query2", "query3"],
  "target_sites": ["https://example.com", "..."],
  "extraction_goals": ["title", "eligibility", "deadline", "application link"],
  "priority": "focus on deadlines within next 14-21 days and first-year / beginner friendly opportunities"
}}

Rules:
- Prefer official pages and well-known platforms (Unstop, Devfolio, Internshala, college sites, AICTE, etc.)
- Maximum 5 search queries
- Maximum 6 target sites
- Make queries specific to the student profile
"""

        return self._generate_with_retry(prompt, max_tokens=4096, temperature=0.2)

    def analyze_and_rank(
        self,
        task: str,
        profile: StudentProfile | None,
        extracted_data: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        profile_text = "No specific profile provided."
        if profile:
            profile_text = (
                f"Year: {profile.year or 'Not specified'}\n"
                f"Branch: {profile.branch or 'Not specified'}\n"
                f"Interests: {profile.interests or 'Not specified'}"
            )

        data_text = json.dumps(extracted_data, indent=2, ensure_ascii=False)

        prompt = f"""
You are Deadline Detective – an expert AI that helps college students find real opportunities.

Student Profile:
{profile_text}

Original Task:
{task}

Here is the raw data extracted from live websites:
{data_text}

Your job:
1. Filter only relevant and currently open opportunities.
2. Decide eligibility based on the student profile (be strict but fair).
3. Extract clean deadline (prefer exact date).
4. Create a clear "what_to_do" action.
5. Rank by urgency + relevance.

Return ONLY valid JSON in this exact format:
{{
  "opportunities": [
    {{
      "title": "Name of opportunity",
      "eligible": true,
      "deadline": "15 Sept 2025 or null",
      "what_to_do": "Register on the official page / Apply before deadline",
      "source": "https://full-url.com",
      "reason": "Short reason for eligibility decision"
    }}
  ],
  "next_3_actions": [
    "1. Opportunity Name — deadline XX — do this",
    "2. ...",
    "3. ..."
  ],
  "summary": "2-3 sentence overall summary for the student"
}}

Rules:
- Only include real opportunities that appear in the data.
- If not eligible, still include it with eligible=false and clear reason.
- Prefer opportunities with clear deadlines in the near future.
- next_3_actions should only contain eligible items when possible.
- Be honest. Do not invent deadlines or opportunities.
"""

        return self._generate_with_retry(prompt, max_tokens=8192, temperature=0.1)
