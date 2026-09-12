# @webcmd/ppt 📊

> **Sub-Second AI Executive Presentation & Slide Deck Synthesizer**

`@webcmd/ppt` connects Groq ultra-fast Llama-3/Qwen inference directly to an autonomous Canva & interactive HTML presentation compiler. It turns a single topic prompt into a complete, beautifully-styled, multi-slide executive deck with custom diagrams, data metrics, key takeaways, and presenter notes in under 500 milliseconds.

---

## ⚡ Features

* **Sub-Second Inference**: Powered by Groq's high-speed API (500–800 tokens/second).
* **Deterministic Fallback Engine**: If no API key is supplied or offline, instantly compiles a production-ready deck using deterministic semantic templates.
* **Interactive HTML Decks**: Generates modern dark-mode responsive slide decks with keyboard navigation (Arrow keys / Space), fullscreen mode (`F`), progress bars, and custom CSS design systems.
* **Autonomous Canva Integration**: Programmatic browser automation for navigating Canva and exporting presentation assets.

---

## 🚀 Quick Start

### Run directly via CLI
```bash
node bin/webcmd-ppt.js "Autonomous Web Agents: Architecture and Execution"
```

### Options
```text
  --headed          Launch browser in visible headed mode
  --profile <name>  Browser profile to use (default: "work")
  --key <key>       Groq API key (or set GROQ_API_KEY environment variable)
  --help, -h        Show help message
```

---

## 🛠️ Programmatic Usage

```javascript
const { CanvaPresentationAgent } = require('@webcmd/ppt');

const agent = new CanvaPresentationAgent({
  headed: false,
  onLog: console.log
});

const deckPath = await agent.buildPresentation("Q3 Engineering Strategy");
console.log("Deck compiled at:", deckPath);
```
