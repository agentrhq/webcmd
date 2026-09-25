from fastapi import APIRouter, HTTPException
from app.models import ResearchRequest, ResearchResponse, HealthResponse
from app.services.agent import DeadlineDetectiveAgent

router = APIRouter(tags=["Research"])

agent = DeadlineDetectiveAgent()


@router.post("/research", response_model=ResearchResponse)
async def run_research(request: ResearchRequest):
    """
    Main endpoint: Run the Deadline Detective browser agent.
    """
    if not request.task or len(request.task.strip()) < 10:
        raise HTTPException(status_code=400, detail="Task must be at least 10 characters long.")

    result = await agent.run(request)
    return result


@router.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(
        status="ok",
        message="Deadline Detective backend is running"
    )
