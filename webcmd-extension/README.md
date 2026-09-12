# Webcmd Chrome Extension (Manifest V3)

> **Autonomous Browser Agent Interface & Perception Visualizer**  
> Built for the **VIT Bhopal Hackathon**

The Webcmd Chrome Extension bridges human browsing with the autonomous, self-learning CDP agent engine. It allows operators and judges to sign in, inspect active web pages with `@eN` perception overlays, manage learned workflows, and trigger self-healing replays.

---

## 🚀 Quick Setup (1 Minute)

### Step 1: Start the Webcmd Local API Server
In your terminal, navigate to `webcmd-main` and start the server:

```bash
cd "d:\web meRGE\webcmd-main"
node bin/webcmd.js serve
```

You should see:
```text
Webcmd Extension Bridge & API Server Online
  🔗 Server URL: http://127.0.0.1:9777
  🛡️  Anti-Bot Stealth: ACTIVE
  🍪 Active Profile: default
  🧩 Extension Ready: Load "webcmd-extension/" into Chrome extensions
```

---

### Step 2: Load the Extension into Google Chrome / Edge / Brave

1. Open **Google Chrome** (or Edge/Brave).
2. Navigate to: `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **"Load unpacked"**.
5. Select this folder:
   ```text
   d:\web meRGE\webcmd-extension
   ```
6. The **Webcmd** extension icon will appear in your Chrome toolbar! Pin it for quick access.

---

## 🌟 Key Features

### 1. 🔐 Sign-In & Cookie-Jar Profiles
- Click the **Profile / Sign-In** button in the top right of the popup.
- Select or create persistent profiles (e.g. `work`, `personal`, `hackathon-judge`).
- All cookies, localStorage, and logins are isolated into `.webcmd/profiles/<name>/`, allowing agents to reuse authenticated sessions without needing plaintext passwords.

### 2. 🧠 Active Tab Perception Inspector (`@eN` Badges)
- Open any website in your browser (e.g., Wikipedia, an e-commerce shop, or your local demo server).
- Open the Webcmd Extension and click **"Inspect Perception (@eN)"**.
- **Live In-Page Overlays**: The extension draws glowing neon badge tags (`@e1`, `@e2`, `@e3`) over every interactive button, input, and link directly on the webpage!
- Click any badge on the webpage to copy its `@eN` reference to your clipboard.
- Hovering over a badge reveals its **Scrapling Structural Fingerprint** (tag, role, id, class).

### 3. ⚡ Workflow Control & 1-Click Replay
- Browse all workflows stored in `.webcmd/workflows/`.
- Inspect step counts, past recoveries, and success rates.
- Click **"⚡ Run Replay"** to execute the workflow directly in Chrome with live Scrapling adaptive recovery.

### 4. 🛡️ Anti-Bot Stealth Shield
- Automatically confirms anti-detection status:
  - `navigator.webdriver` set to `false`.
  - `window.chrome` stub active.
  - WebGL vendor masking enabled.
  - CDP stack trace scrubbing active.

### 5. 📜 Live Telemetry Stream
- Switch to the **Telemetry** tab in the popup to view real-time logs, CDP latency, candidate relocation scores, and verification passes.

---

## 🎯 Hackathon Live Demo Sequence

1. Open Chrome with the local demo store or Wikipedia loaded.
2. Click the **Webcmd Extension** icon.
3. Show the judges the **Online Status** and **Stealth Shield: ACTIVE**.
4. Click **"Inspect Perception (@eN)"**:
   - Point to the live website: watch the glowing `@eN` badges attach to search inputs and buttons in real-time.
   - Click a badge to demonstrate Scrapling fingerprint extraction.
5. In the **Workflows tab**, click **"⚡ Run Replay"** on `demo-search-and-cart`.
6. Watch the agent replay the workflow at native CDP speed, handle DOM mutations, recover automatically, and report **100% verification pass** in the extension telemetry!
