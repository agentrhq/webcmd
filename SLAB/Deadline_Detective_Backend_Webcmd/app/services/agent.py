from app.services.gemini import GeminiService
from app.services.webcmd_service import WebcmdService
from app.models import ResearchRequest, ResearchResponse, Opportunity
from typing import List
import traceback


class DeadlineDetectiveAgent:
    def __init__(self):
        self.gemini = GeminiService()
        self.webcmd = WebcmdService()

    async def run(self, request: ResearchRequest) -> ResearchResponse:
        try:
            # Step 1: Gemini creates the research plan
            plan = self.gemini.create_research_plan(
                task=request.task,
                profile=request.profile
            )

            # Step 2: Webcmd collects evidence from real websites
            evidence = await self.webcmd.search_and_collect(plan)

            if not evidence:
                return ResearchResponse(
                    opportunities=[],
                    next_3_actions=["No opportunities found. Try a more specific query or check if Webcmd is installed."],
                    summary="The agent could not extract useful information. Make sure Webcmd is installed and working (`webcmd doctor`).",
                    sources_checked=[]
                )

            # Step 3: Gemini analyzes eligibility and ranks
            analysis = self.gemini.analyze_and_rank(
                task=request.task,
                profile=request.profile,
                extracted_data=evidence
            )

            # Step 4: Build final structured response
            opportunities: List[Opportunity] = []
            for item in analysis.get("opportunities", []):
                opportunities.append(
                    Opportunity(
                        title=item.get("title", "Unknown"),
                        eligible=bool(item.get("eligible", False)),
                        deadline=item.get("deadline"),
                        what_to_do=item.get("what_to_do", "Check the official page"),
                        source=item.get("source", ""),
                        reason=item.get("reason")
                    )
                )

            sources = [e["url"] for e in evidence if e.get("url")]

            return ResearchResponse(
                opportunities=opportunities,
                next_3_actions=analysis.get("next_3_actions", []),
                summary=analysis.get("summary", "Research completed using Webcmd browser agent."),
                sources_checked=sources
            )

        except Exception as e:
            traceback.print_exc()
            return ResearchResponse(
                opportunities=[],
                next_3_actions=[],
                summary=f"An error occurred while running the agent: {str(e)[:300]}",
                sources_checked=[]
            )
