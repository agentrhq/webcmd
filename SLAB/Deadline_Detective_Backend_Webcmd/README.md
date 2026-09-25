# Deadline Detective – Backend (Webcmd Version)

AI Browser Agent that finds real college opportunities using **Webcmd** for browser automation.

## What changed
- Replaced raw Playwright with **Webcmd**
- Still uses FastAPI + Gemini for planning and analysis
- Browser control now goes through Webcmd sessions

## Tech Stack
- FastAPI
- Google Gemini
- **Webcmd** (self-learning browser infrastructure)
- Docker ready

## Prerequisites

1. Node.js 20+
2. Webcmd installed:
   ```bash
   npm install -g @agentrhq/webcmd
   webcmd doctor
   ```

## Local Setup

```bash
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Create .env
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY

uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## API

- `POST /research` → main agent endpoint
- `GET /health` → health check
- Docs: http://localhost:8000/docs

## How it works

1. Gemini creates a research plan
2. Webcmd opens a browser session
3. Webcmd visits real websites and extracts content
4. Gemini analyzes eligibility + deadlines
5. Returns prioritized action plan

## Deploy on Render

- Use the included Dockerfile
- Add environment variable `GEMINI_API_KEY`
- Make sure the instance has enough memory (Webcmd + browser needs it)
