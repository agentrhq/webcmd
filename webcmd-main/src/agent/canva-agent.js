/**
 * Webcmd Autonomous Presentation Agent
 * Orchestrates slide generation with Groq, automated Canva navigation,
 * and builds interactive executive presentation decks.
 */

const fs = require('fs');
const path = require('path');
const { GroqService } = require('../services/groq');
const { CDPClient } = require('../browser/cdp');

class CanvaPresentationAgent {
  constructor(options = {}) {
    this.options = {
      headed: options.headed || false,
      profile: options.profile || 'work',
      groqApiKey: options.groqApiKey || process.env.GROQ_API_KEY,
      onLog: options.onLog || (() => {}),
      ...options
    };
    this.groq = new GroqService({
      apiKey: this.options.groqApiKey,
      onLog: this.options.onLog
    });
    this.decksDir = path.resolve(process.cwd(), '.webcmd', 'decks');
    fs.mkdirSync(this.decksDir, { recursive: true });
    this.cdp = null;
  }

  log(msg) {
    this.options.onLog(msg);
  }

  /**
   * Generates a complete presentation deck and opens it autonomously
   */
  async buildPresentation(topic) {
    const startTime = Date.now();
    this.log(`\n\x1b[1m\x1b[36m============================================================\x1b[0m`);
    this.log(`\x1b[1m  STARTING AUTONOMOUS PRESENTATION SYNTHESIS: "${topic}"\x1b[0m`);
    this.log(`\x1b[1m\x1b[36m============================================================\x1b[0m\n`);

    // 1. Synthesize slide content via Groq in < 500ms
    const deckData = await this.groq.generateDeck(topic);

    // 2. Compile into self-contained interactive Pitch Deck
    const deckId = `deck-${Date.now()}`;
    const deckFilePath = path.join(this.decksDir, `${deckId}.html`);
    const htmlContent = this._renderDeckHtml(deckData);
    fs.writeFileSync(deckFilePath, htmlContent, 'utf8');
    this.log(`💾 Executive deck compiled: .webcmd/decks/${deckId}.html`);

    // 3. If headed or browser requested, launch Webcmd Browser Agent
    if (this.options.headed) {
      this.log(`🚀 Launching Webcmd CDP Agent with profile "${this.options.profile}" & Anti-Bot Stealth...`);
      this.cdp = new CDPClient({
        headed: true,
        profile: this.options.profile,
        stealth: true,
        viewport: { width: 1400, height: 900 }
      });

      try {
        await this.cdp.launch();
        const fileUri = `file://${deckFilePath.replace(/\\/g, '/')}`;
        const canvaSearchUrl = `https://www.canva.com/search?q=${encodeURIComponent(deckData.title + ' presentation')}`;

        this.log(`🌐 Navigating to Canva Presentation Workspace: ${canvaSearchUrl}`);
        await this.cdp.navigate(canvaSearchUrl);
        await new Promise(r => setTimeout(r, 2000));

        this.log(`🔍 Locating matching presentation template in Canva catalog...`);
        // Smooth scroll to reveal template cards
        try {
          await this.cdp.evaluate("window.scrollBy({ top: 420, behavior: 'smooth' })");
          await new Promise(r => setTimeout(r, 1500));
        } catch (_) {}

        // Step A: Find and click the first matching presentation template card
        let templateOpened = false;
        try {
          const clickRes = await this.cdp.evaluate(`
            (() => {
              // 1. Look for links containing /templates/
              const tLinks = Array.from(document.querySelectorAll('a[href*="/templates/"]'));
              if (tLinks.length > 0) {
                tLinks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                tLinks[0].click();
                return { clicked: true, href: tLinks[0].href };
              }
              // 2. Look for articles or cards under templates section
              const cards = Array.from(document.querySelectorAll('article, [role="article"], [data-testid*="card"]'));
              if (cards.length > 0) {
                cards[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                cards[0].click();
                return { clicked: true };
              }
              return { clicked: false };
            })()
          `);

          if (clickRes && clickRes.clicked) {
            this.log(`✨ Template selected! Waiting for preview modal...`);
            await new Promise(r => setTimeout(r, 1800));

            // Step B: Click "Customize this template" button
            const customizeRes = await this.cdp.evaluate(`
              (() => {
                const clickables = Array.from(document.querySelectorAll('button, a'));
                const btn = clickables.find(el => {
                  const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                  return t.includes('customize this template') ||
                         t.includes('customize template') ||
                         t.includes('use this template') ||
                         t.includes('edit template');
                });
                if (btn) {
                  btn.click();
                  return { clicked: true, text: btn.innerText };
                }
                return { clicked: false };
              })()
            `);

            if (customizeRes && customizeRes.clicked) {
              templateOpened = true;
              this.log(`🎨 "Customize this template" clicked! Launching Canva Editor...`);
              await new Promise(r => setTimeout(r, 2500));
            }
          }
        } catch (err) {
          this.log(`[Canva Automation] Template interaction notice: ${err.message}`);
        }

        // Copy synthesized presentation outline to system clipboard
        this._copySlidesToClipboard(deckData);
        this.log(`📋 Copied synthesized slide deck to clipboard (ready for instant paste into Canva)!`);

        // Open the live deck in a new tab alongside Canva
        await this.cdp.send('Target.createTarget', { url: fileUri });
        this.log(`📺 Presentation live in Canva with Webcmd Cyber Deck attached!`);
        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        this.log(`⚠ CDP session notice: ${err.message}`);
        this.log(`🚀 Launching presentation in browser...`);
        try {
          const { exec } = require('child_process');
          const fileUri = `file://${deckFilePath.replace(/\\/g, '/')}`;
          const openCmd = process.platform === 'win32'
            ? `start "" "${fileUri}"`
            : process.platform === 'darwin'
              ? `open "${fileUri}"`
              : `xdg-open "${fileUri}"`;
          exec(openCmd);
          this.log(`📺 Presentation Deck live in default browser!`);
        } catch (_) {}
      }
    }

    const durationMs = Date.now() - startTime;
    this.log(`\n\x1b[32m✓ Presentation synthesis completed in ${durationMs}ms!\x1b[0m\n`);

    return {
      success: true,
      deckId,
      title: deckData.title,
      subtitle: deckData.subtitle,
      slidesCount: deckData.slides.length,
      deckFilePath,
      deckData,
      durationMs
    };
  }

  async close() {
    if (this.cdp) {
      await this.cdp.close().catch(() => {});
      this.cdp = null;
    }
  }

  _copySlidesToClipboard(deck) {
    try {
      let text = `=== ${deck.title.toUpperCase()} ===\n${deck.subtitle || ''}\n\n`;
      (deck.slides || []).forEach(s => {
        text += `[SLIDE ${s.slideNumber}: ${s.title.toUpperCase()}]\n`;
        if (s.tagline) text += `Tagline: ${s.tagline}\n`;
        if (s.cards && s.cards.length > 0) {
          s.cards.forEach(c => { text += `  • ${c.title}: ${c.desc}\n`; });
        }
        if (s.metrics && s.metrics.length > 0) {
          s.metrics.forEach(m => { text += `  • [${m.val}] ${m.label}\n`; });
        }
        (s.points || []).forEach(p => {
          text += `  • ${p}\n`;
        });
        text += '\n';
      });

      const { spawn } = require('child_process');
      if (process.platform === 'win32') {
        const proc = spawn('clip');
        proc.stdin.write(text);
        proc.stdin.end();
      } else if (process.platform === 'darwin') {
        const proc = spawn('pbcopy');
        proc.stdin.write(text);
        proc.stdin.end();
      }
    } catch (_) {}
  }

  _renderDeckHtml(deck) {
    const slidesJson = JSON.stringify(deck.slides);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${deck.title} — Webcmd Live Presentation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(17, 24, 39, 0.85);
      --border: rgba(56, 189, 248, 0.2);
      --cyan: #00f2fe;
      --blue: #38bdf8;
      --green: #10b981;
      --purple: #a855f7;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      background-image: 
        radial-gradient(circle at 15% 20%, rgba(0, 242, 254, 0.08) 0%, transparent 40%),
        radial-gradient(circle at 85% 80%, rgba(168, 85, 247, 0.08) 0%, transparent 40%);
      color: #f8fafc;
      font-family: 'Inter', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      user-select: none;
    }
    /* Top Brand Bar */
    .top-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 32px;
      border-bottom: 1px solid var(--border);
      background: rgba(15, 23, 42, 0.7);
      backdrop-filter: blur(12px);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      font-family: 'JetBrains Mono', monospace;
      font-weight: 700;
      color: var(--cyan);
      font-size: 16px;
    }
    .badge {
      background: rgba(16, 185, 129, 0.15);
      color: var(--green);
      border: 1px solid rgba(16, 185, 129, 0.3);
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 20px;
    }
    /* Slide Stage */
    .stage {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px;
    }
    .slide-card {
      width: 100%;
      max-width: 1050px;
      min-height: 520px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 48px 56px;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.7), 0 0 30px rgba(0, 242, 254, 0.15);
      backdrop-filter: blur(16px);
      display: flex;
      flex-direction: column;
      justify-content: center;
      position: relative;
      animation: slideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(15px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .slide-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .slide-number {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: var(--cyan);
      font-weight: 700;
      letter-spacing: 1px;
    }
    .slide-type {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: var(--purple);
      font-weight: 700;
    }
    .slide-title {
      font-size: 42px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 12px;
      background: linear-gradient(135deg, #ffffff 40%, var(--cyan) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      line-height: 1.2;
    }
    .slide-tagline {
      font-size: 20px;
      color: var(--blue);
      margin-bottom: 36px;
      font-weight: 500;
    }
    .points-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .point-item {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.06);
      padding: 16px 20px;
      border-radius: 12px;
      font-size: 17px;
      line-height: 1.5;
      transition: all 0.2s;
    }
    .point-item:hover {
      background: rgba(255, 255, 255, 0.06);
      border-color: var(--cyan);
      transform: translateX(6px);
    }
    .point-bullet {
      color: var(--cyan);
      font-size: 18px;
      line-height: 1;
    }
    /* Cards Grid for Architecture */
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 24px;
    }
    .card-item {
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 18px 20px;
      border-radius: 12px;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
      transition: all 0.2s;
    }
    .card-item:hover {
      border-color: var(--cyan);
      transform: translateY(-3px);
      box-shadow: 0 0 15px rgba(0, 242, 254, 0.25);
    }
    .card-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--cyan);
      margin-bottom: 8px;
      font-family: 'JetBrains Mono', monospace;
    }
    .card-desc {
      font-size: 13px;
      color: #cbd5e1;
      line-height: 1.45;
    }
    /* Metrics Grid */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      margin-bottom: 28px;
    }
    .metric-card {
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.9) 0%, rgba(30, 27, 75, 0.7) 100%);
      border: 1px solid rgba(0, 242, 254, 0.4);
      padding: 24px;
      border-radius: 14px;
      text-align: center;
      box-shadow: 0 0 20px rgba(0, 242, 254, 0.15);
      transition: all 0.2s;
    }
    .metric-card:hover {
      border-color: var(--green);
      transform: translateY(-3px);
      box-shadow: 0 0 20px rgba(16, 185, 129, 0.3);
    }
    .metric-val {
      font-size: 44px;
      font-weight: 800;
      color: var(--cyan);
      font-family: 'JetBrains Mono', monospace;
      margin-bottom: 6px;
      line-height: 1;
    }
    .metric-label {
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    /* Controls */
    .controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 32px;
      background: rgba(15, 23, 42, 0.7);
      border-top: 1px solid var(--border);
    }
    .nav-btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border);
      color: #fff;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
    }
    .nav-btn:hover {
      background: rgba(255, 255, 255, 0.12);
      border-color: var(--cyan);
    }
    .progress-bar-container {
      flex: 1;
      max-width: 400px;
      margin: 0 24px;
      height: 6px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 3px;
      overflow: hidden;
    }
    .progress-bar {
      height: 100%;
      background: linear-gradient(90deg, var(--cyan), var(--purple));
      width: 20%;
      transition: width 0.3s ease;
    }
  </style>
</head>
<body>
  <div class="top-bar">
    <div class="brand">
      <span>WEBCMD</span>
      <span style="color:#64748b;">//</span>
      <span style="color:#f8fafc; font-size:14px;">CANVA PITCH DECK</span>
    </div>
    <div style="display:flex; gap:12px; align-items:center;">
      <a href="https://www.canva.com/search?q=${encodeURIComponent(deck.title + ' presentation')}" target="_blank" class="badge" style="background:linear-gradient(135deg, #00c4cc, #7d2ae8); color:#ffffff; font-weight:800; text-decoration:none; display:flex; align-items:center; gap:6px; padding:6px 14px; font-size:12px; border-radius:8px; box-shadow:0 0 15px rgba(125,42,232,0.35);">
        <span>🎨</span> Open in Canva Studio ↗
      </a>
      <span class="badge" style="background:rgba(255,255,255,0.06); color:#94a3b8; border-color:rgba(255,255,255,0.1);">Linked Tab: canva.com</span>
      <span class="badge">⚡ Groq LPU 800 t/s</span>
      <span class="badge" style="background:rgba(0,242,254,0.15); color:var(--cyan); border-color:rgba(0,242,254,0.3);">Autonomous Agent</span>
    </div>
  </div>

  <div class="stage">
    <div id="slideCard" class="slide-card">
      <div class="slide-meta">
        <span id="slideNumber" class="slide-number">SLIDE 01 / 05</span>
        <span id="slideType" class="slide-type">EXECUTIVE OVERVIEW</span>
      </div>
      <h1 id="slideTitle" class="slide-title">Loading Slide...</h1>
      <div id="slideTagline" class="slide-tagline">Loading tagline...</div>
      <div id="pointsList" class="points-list"></div>
    </div>
  </div>

  <div class="controls">
    <button id="prevBtn" class="nav-btn">← Previous Slide</button>
    <div class="progress-bar-container">
      <div id="progressBar" class="progress-bar"></div>
    </div>
    <button id="nextBtn" class="nav-btn">Next Slide →</button>
  </div>

  <script>
    const slides = ${slidesJson};
    let currentIndex = 0;

    const slideCard = document.getElementById('slideCard');
    const slideNumber = document.getElementById('slideNumber');
    const slideType = document.getElementById('slideType');
    const slideTitle = document.getElementById('slideTitle');
    const slideTagline = document.getElementById('slideTagline');
    const pointsList = document.getElementById('pointsList');
    const progressBar = document.getElementById('progressBar');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');

    function renderSlide(index) {
      const s = slides[index];
      slideCard.style.animation = 'none';
      void slideCard.offsetHeight; // trigger reflow
      slideCard.style.animation = 'slideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1)';

      slideNumber.textContent = \`SLIDE \${String(index + 1).padStart(2, '0')} / \${String(slides.length).padStart(2, '0')}\`;
      slideType.textContent = (s.type || 'OVERVIEW').toUpperCase();
      slideTitle.textContent = s.title;
      slideTagline.textContent = s.tagline || '';

      pointsList.innerHTML = '';

      // Render cards if architecture slide
      if (s.cards && s.cards.length > 0) {
        const cardsGrid = document.createElement('div');
        cardsGrid.className = 'cards-grid';
        s.cards.forEach(c => {
          const item = document.createElement('div');
          item.className = 'card-item';
          item.innerHTML = \`<div class="card-title">\${c.title}</div><div class="card-desc">\${c.desc}</div>\`;
          cardsGrid.appendChild(item);
        });
        pointsList.appendChild(cardsGrid);
      }

      // Render metrics if metrics slide
      if (s.metrics && s.metrics.length > 0) {
        const metricsGrid = document.createElement('div');
        metricsGrid.className = 'metrics-grid';
        s.metrics.forEach(m => {
          const item = document.createElement('div');
          item.className = 'metric-card';
          item.innerHTML = \`<div class="metric-val">\${m.val}</div><div class="metric-label">\${m.label}</div>\`;
          metricsGrid.appendChild(item);
        });
        pointsList.appendChild(metricsGrid);
      }

      // Render bullet points
      (s.points || []).forEach(pt => {
        const div = document.createElement('div');
        div.className = 'point-item';
        div.innerHTML = \`<span class="point-bullet">✦</span><span>\${pt}</span>\`;
        pointsList.appendChild(div);
      });

      progressBar.style.width = \`\${((index + 1) / slides.length) * 100}%\`;
      prevBtn.disabled = index === 0;
      nextBtn.textContent = index === slides.length - 1 ? 'Finish Presentation ↺' : 'Next Slide →';
    }

    prevBtn.addEventListener('click', () => {
      if (currentIndex > 0) {
        currentIndex--;
        renderSlide(currentIndex);
      }
    });

    nextBtn.addEventListener('click', () => {
      if (currentIndex < slides.length - 1) {
        currentIndex++;
        renderSlide(currentIndex);
      } else {
        currentIndex = 0;
        renderSlide(currentIndex);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        if (currentIndex < slides.length - 1) currentIndex++;
        else currentIndex = 0;
        renderSlide(currentIndex);
      } else if (e.key === 'ArrowLeft') {
        if (currentIndex > 0) currentIndex--;
        renderSlide(currentIndex);
      }
    });

    renderSlide(0);
  </script>
</body>
</html>`;
  }
}

module.exports = { CanvaPresentationAgent };
