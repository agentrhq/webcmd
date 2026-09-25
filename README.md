# Application Rescue Agent 🛟

A hackathon MVP that helps students find relevant opportunities (internships,
scholarships, fellowships, competitions, grants, university programs) and
**rescues** their applications before deadlines, confusing forms, or missing
documents cost them the opportunity.

> **Core flow:** Profile → Discover → Match → Apply with Rescue Agent →
> Analyze Form → Auto-fill → Detect Missing Items → Fix → Review →
> User Approval → Submit

The Rescue Agent **never auto-submits**. It fills what it safely can, flags
what's missing, and waits for the student to click **Approve & Submit**.

---

## Tech stack

| Layer     | Tech                                            |
|-----------|--------------------------------------------------|
| Frontend  | React + Vite + Tailwind CSS + React Router        |
| Backend   | Node.js + Express                                 |
| Database  | MongoDB + Mongoose                                |
| Rescue engine | `webcmdService.js` — DEMO mode (scripted) or REAL mode (Webcmd CLI) |

---

## Folder structure

```
application-rescue-agent/
├── backend/
│   ├── config/db.js                  # MongoDB connection
│   ├── models/                       # User, Profile, Opportunity, Document, Application
│   ├── controllers/                  # Route handlers
│   ├── routes/                       # Express routers
│   ├── services/
│   │   ├── matchEngine.js            # Match % scoring
│   │   └── webcmdService.js          # Webcmd integration (DEMO/REAL)
│   ├── seed/seed.js                  # Demo data seeder
│   ├── server.js
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── api/api.js                # Axios client for all backend endpoints
    │   ├── components/               # Sidebar, cards, badges, progress bar, etc.
    │   ├── pages/                    # Dashboard, Profile, Discover, OpportunityDetails,
    │   │                             # Documents, Applications, ApplicationRescue
    │   ├── App.jsx
    │   └── index.css
    ├── tailwind.config.js
    └── vite.config.js
```

---

## Setup

### Prerequisites
- Node.js 18+
- A running MongoDB instance (local `mongod`, Docker, or a free MongoDB Atlas cluster)

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env
# edit .env if your MongoDB URI or port differ from the defaults
npm run seed     # populates demo user, profile, 15 opportunities, and document vault
npm run dev      # starts the API on http://localhost:5000 (nodemon)
# or: npm start
```

Verify it's alive:

```bash
curl http://localhost:5000/api/health
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev      # starts on http://localhost:5173
```

The Vite dev server proxies `/api/*` requests to `http://localhost:5000`
(see `frontend/vite.config.js`), so just open **http://localhost:5173**.

### 3. (Optional) Build for production

```bash
cd frontend && npm run build     # outputs to frontend/dist
cd backend  && npm start
```
Serve `frontend/dist` with any static host, or add `express.static` to
`server.js` if you want the backend to serve the built frontend directly.

---

## Environment variables (`backend/.env`)

| Variable         | Default                                              | Notes |
|------------------|-------------------------------------------------------|-------|
| `MONGO_URI`      | `mongodb://127.0.0.1:27017/application_rescue_agent`   | Local or Atlas connection string |
| `PORT`           | `5000`                                                 | Backend port |
| `WEBCMD_MODE`    | `DEMO`                                                 | `DEMO` or `REAL` |
| `WEBCMD_CLI_PATH`| `webcmd`                                               | Only used when `WEBCMD_MODE=REAL` |

---

## Backend API reference

| Method | Route                              | Description |
|--------|-------------------------------------|--------------|
| GET    | `/api/health`                       | Health check + current Webcmd mode |
| GET    | `/api/profile`                      | Get the student profile |
| POST   | `/api/profile`                      | Create/update the student profile |
| GET    | `/api/opportunities`                | All opportunities with Match % |
| GET    | `/api/opportunities/recommended`    | Top opportunities sorted by Match % (`?limit=`) |
| GET    | `/api/opportunities/:id`            | Single opportunity detail |
| GET    | `/api/documents`                    | Document vault status |
| POST   | `/api/documents/upload`             | `{ type, fileName }` → marks a document uploaded |
| GET    | `/api/applications`                 | All applications for the student |
| POST   | `/api/applications`                 | `{ opportunityId }` → start/resume a Rescue application |
| GET    | `/api/applications/:id`             | Single application detail |
| POST   | `/api/applications/:id/analyze`     | **Runs the Rescue Agent** — opens the form, auto-fills, detects missing items |
| POST   | `/api/applications/:id/submit`      | Explicit, user-triggered submission (blocked until "Ready for Review") |

---

## How matching works

`services/matchEngine.js` computes an explainable **0–100 Match %** per
opportunity, no ML required for the MVP:

- Skills overlap — 40 pts
- Interests overlap — 20 pts
- CGPA eligibility — 20 pts
- Preferred opportunity type — 15 pts
- Has experience listed — 5 pts

## How the Rescue Agent works (`webcmdService.js`)

This is the **only** file that knows about Webcmd, so the rest of the app
never changes when you swap modes:

- **DEMO mode** (default): a deterministic, scripted analysis against a
  fixed demo application form (Name, Email, University, Degree, Branch,
  Skills, Resume, Transcript, SOP). It reads the student's Profile and
  Document Vault, fills every field it safely can, and reports the rest as
  missing. This is 100% reliable for a live hackathon demo — no network
  calls, no flakiness.
- **REAL mode**: shells out to an installed **Webcmd CLI** binary
  (`webcmd analyze --url <applyUrl> --profile <json> --json`) to actually
  open the target form in a browser and read/fill real fields. If the CLI
  isn't installed, times out, or returns bad output, the service logs the
  failure and **falls back to DEMO analysis** so the flow never breaks
  mid-demo. Adjust the CLI invocation in `runRealAnalysis()` to match your
  actual Webcmd CLI's interface.

Toggle modes via `WEBCMD_MODE` in `backend/.env` — no code changes needed.

---

## Demo script (what to show the judges)

1. **Profile** — the seeded demo student (Ketna Sharma, B.Tech CS, VIT
   Bhopal, CGPA 8.4) is already filled in. *"It knows me."*
2. **Discover** — 15 real-feeling opportunities across 6 categories, each
   with a computed Match %. Sort by best match. *"It finds the right
   opportunity."*
3. Open an opportunity → **Apply with Rescue Agent**.
4. On the **Application Rescue** page, click **Run Rescue Agent** — watch
   the Webcmd activity log stream in, fields auto-fill from the profile and
   document vault. *"It opens the application and fills it."*
5. **SOP** is missing on purpose → status shows **Missing Items**.
   *"It finds what's missing."*
6. Click **Upload now** next to SOP (or go to the **Documents** vault) →
   Rescue Agent re-runs automatically → status flips to **Ready for
   Review**, completion hits 100%. *"It rescues it."*
7. Review the filled fields, then click **Approve & Submit** (with a
   confirmation prompt). Status becomes **Submitted**. *"It gets my
   approval, then submits it."*

---

## Explicit non-goals (kept simple on purpose)

No complex authentication, OCR, vector database, real-time scraping,
notifications, or microservices — this is a focused 4-hour hackathon MVP.
The app operates as a single seeded demo user throughout (no login screen).
