from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from app.routers import research

app = FastAPI(
    title="Deadline Detective",
    description="AI Browser Agent that finds real college opportunities, verifies eligibility & deadlines, and creates action plans.",
    version="1.0.0"
)

# Allow frontend (Vercel / local / Render static) to call the API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # For hackathon – tighten later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(research.router)

# Serve frontend static files
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
async def root():
    return FileResponse(str(FRONTEND_DIR / "index.html"))
