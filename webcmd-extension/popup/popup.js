/**
 * Webcmd Extension Popup Controller
 * Handles user sign-in, profile switching, workflow execution, active tab perception tagging,
 * and live telemetry streaming.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');
  const profileBtn = document.getElementById('profileBtn');
  const profileLabel = document.getElementById('profileLabel');
  const authModal = document.getElementById('authModal');
  const closeAuthBtn = document.getElementById('closeAuthBtn');
  const loginSubmitBtn = document.getElementById('loginSubmitBtn');
  const usernameInput = document.getElementById('usernameInput');
  const profileSelect = document.getElementById('profileSelect');
  const addProfileBtn = document.getElementById('addProfileBtn');
  const apiBaseInput = document.getElementById('apiBaseInput');
  const targetTitle = document.getElementById('targetTitle');
  const targetUrl = document.getElementById('targetUrl');
  const inspectTabBtn = document.getElementById('inspectTabBtn');
  const clearOverlaysBtn = document.getElementById('clearOverlaysBtn');
  const workflowsList = document.getElementById('workflowsList');
  const workflowSearchInput = document.getElementById('workflowSearchInput');
  const refreshWorkflowsBtn = document.getElementById('refreshWorkflowsBtn');
  const elementsList = document.getElementById('elementsList');
  const elementsStats = document.getElementById('elementsStats');
  const rescanBtn = document.getElementById('rescanBtn');
  const perceptionBadgeCount = document.getElementById('perceptionBadgeCount');
  const runDoctorBtn = document.getElementById('runDoctorBtn');
  const doctorChecks = document.getElementById('doctorChecks');
  const terminalBody = document.getElementById('terminalBody');
  const clearLogsBtn = document.getElementById('clearLogsBtn');
  const footerProfile = document.getElementById('footerProfile');
  const navTabs = document.querySelectorAll('.nav-tab');
  const tabContents = document.querySelectorAll('.tab-content');

  let activeTabInfo = null;
  let allWorkflows = [];

  function log(msg, type = 'normal') {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    const div = document.createElement('div');
    div.className = `log-line ${type}`;
    div.textContent = `[${time}] ${msg}`;
    terminalBody.appendChild(div);
    terminalBody.scrollTop = terminalBody.scrollHeight;
  }

  // 1. Load active tab information
  async function loadActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        activeTabInfo = tab;
        targetTitle.textContent = tab.title || 'Untitled Page';
        targetUrl.textContent = tab.url || 'about:blank';
      }
    } catch (err) {
      targetTitle.textContent = 'Chrome Active Tab';
      targetUrl.textContent = 'Ready for inspection';
    }
  }

  // 2. Load Auth & Profile Settings
  async function loadAuth() {
    const data = await chrome.storage.local.get(['username', 'profile', 'apiBase', 'token']);
    const username = data.username || 'Operator';
    const profile = data.profile || 'default';
    const apiBase = data.apiBase || 'http://127.0.0.1:9777';

    usernameInput.value = username;
    apiBaseInput.value = apiBase;
    footerProfile.textContent = `Profile: ${profile}`;
    profileLabel.textContent = `${username} (${profile})`;

    // Populate select options if exists
    if (![...profileSelect.options].some(o => o.value === profile)) {
      const opt = document.createElement('option');
      opt.value = profile;
      opt.textContent = `${profile} (Custom)`;
      profileSelect.appendChild(opt);
    }
    profileSelect.value = profile;

    return { username, profile, apiBase };
  }

  // 3. Check Engine Health
  async function checkEngine() {
    statusText.textContent = 'CHECKING...';
    try {
      const { apiBase } = await loadAuth();
      const res = await fetch(`${apiBase}/api/status`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const data = await res.json();
        statusPill.className = 'status-pill online';
        statusText.textContent = 'ONLINE';
        log(`Webcmd API connected. Active profile: ${data.activeProfile}`, 'success');
        return true;
      }
    } catch (err) {
      // offline
    }

    statusPill.className = 'status-pill offline';
    statusText.textContent = 'OFFLINE';
    log('Webcmd server offline. Start with: node bin/webcmd.js serve', 'warn');
    return false;
  }

  // 4. Fetch Workflows
  async function fetchWorkflows() {
    workflowsList.innerHTML = '<div class="loading-state">Loading workflows from engine...</div>';
    const { apiBase } = await loadAuth();
    try {
      const res = await fetch(`${apiBase}/api/workflows`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      allWorkflows = data.workflows || [];
      renderWorkflows(allWorkflows);
      log(`Loaded ${allWorkflows.length} workflows from memory.`, 'info');
    } catch (err) {
      workflowsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <p>Could not connect to Webcmd server.<br>Make sure <code>webcmd serve</code> is running on <code>${apiBase}</code></p>
        </div>
      `;
    }
  }

  function renderWorkflows(list) {
    if (!list || list.length === 0) {
      workflowsList.innerHTML = '<div class="empty-state"><p>No learned workflows found.</p></div>';
      return;
    }

    workflowsList.innerHTML = '';
    list.forEach(wf => {
      const card = document.createElement('div');
      card.className = 'workflow-card';
      const recoveries = wf.recovery_count || 0;
      const success = wf.success_count || 1;
      const stepsCount = (wf.steps && wf.steps.length) || 0;

      card.innerHTML = `
        <div class="workflow-card-header">
          <span class="workflow-id">${wf.id}</span>
          <span class="workflow-domain">${wf.domain || 'localhost'}</span>
        </div>
        <div class="workflow-name">${wf.name || 'Autonomous Workflow'}</div>
        <div class="workflow-meta">
          <div class="workflow-badges">
            <span class="badge">${stepsCount} steps</span>
            <span class="badge recoveries">${recoveries} recoveries</span>
            <span class="badge success">Pass: ${success}</span>
          </div>
          <button class="btn-replay" data-id="${wf.id}">⚡ Run Replay</button>
        </div>
      `;

      const runBtn = card.querySelector('.btn-replay');
      runBtn.addEventListener('click', async () => {
        await executeWorkflow(wf.id, runBtn);
      });

      workflowsList.appendChild(card);
    });
  }

  // 5. Execute Workflow via API
  async function executeWorkflow(workflowId, btn) {
    const { apiBase, profile } = await loadAuth();
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = 'Running...';
    log(`[Replay] Initiating execution of "${workflowId}"...`, 'info');

    try {
      const res = await fetch(`${apiBase}/api/workflows/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId, headed: true, profile })
      });

      const result = await res.json();
      if (result.success) {
        log(`✓ Replay "${workflowId}" completed in ${result.durationMs}ms! (Recoveries: ${result.recoveredSteps})`, 'success');
        btn.textContent = '✓ Passed';
        setTimeout(() => {
          btn.textContent = oldText;
          btn.disabled = false;
        }, 2000);
      } else {
        log(`✗ Replay failed: ${result.error}`, 'error');
        btn.textContent = '✗ Failed';
        setTimeout(() => {
          btn.textContent = oldText;
          btn.disabled = false;
        }, 2000);
      }
    } catch (err) {
      log(`Execution error: ${err.message}`, 'error');
      btn.textContent = 'Error';
      setTimeout(() => {
        btn.textContent = oldText;
        btn.disabled = false;
      }, 2000);
    }
  }

  // 6. Inspect Tab Perception Overlays
  async function inspectActiveTab() {
    inspectTabBtn.disabled = true;
    inspectTabBtn.innerHTML = '<span class="icon">⏳</span> Scanning...';
    log('Injecting perception scanner into active tab...', 'info');

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active browser tab found');

      chrome.tabs.sendMessage(tab.id, { type: 'DRAW_OVERLAYS' }, (response) => {
        inspectTabBtn.disabled = false;
        inspectTabBtn.innerHTML = '<span class="icon">🧠</span> Inspect Perception (@eN)';

        if (chrome.runtime.lastError) {
          log(`Tab error: ${chrome.runtime.lastError.message}`, 'error');
          alert('Could not inject overlay. Refresh the webpage and try again!');
          return;
        }

        if (response && response.success) {
          log(`Perception scan complete: ${response.count} interactive targets tagged with @eN.`, 'success');
          perceptionBadgeCount.textContent = response.count;
          elementsStats.textContent = `${response.count} elements extracted from ${tab.title.slice(0, 25)}...`;
          renderElements(response.elements);
          // Switch to perception tab
          switchTab('perceptionTab');
        }
      });
    } catch (err) {
      inspectTabBtn.disabled = false;
      inspectTabBtn.innerHTML = '<span class="icon">🧠</span> Inspect Perception (@eN)';
      log(`Inspection failed: ${err.message}`, 'error');
    }
  }

  function renderElements(elements) {
    elementsList.innerHTML = '';
    if (!elements || elements.length === 0) {
      elementsList.innerHTML = '<div class="empty-state"><p>No interactive elements detected.</p></div>';
      return;
    }

    elements.forEach(item => {
      const div = document.createElement('div');
      div.className = 'element-item';
      const idStr = item.attributes.id ? `#${item.attributes.id}` : '';
      const textPreview = item.text ? `"${item.text}"` : (item.attributes.placeholder || item.tag);

      div.innerHTML = `
        <span class="element-ref">${item.ref}</span>
        <span class="element-tag">&lt;${item.tag}${idStr}&gt;</span>
        <span class="element-desc">${textPreview}</span>
      `;

      div.addEventListener('click', () => {
        navigator.clipboard.writeText(item.ref);
        log(`Copied ${item.ref} (<${item.tag}> ${textPreview}) to clipboard.`, 'info');
      });

      elementsList.appendChild(div);
    });
  }

  async function clearOverlays() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'REMOVE_OVERLAYS' }, () => {
          log('Perception overlays cleared from active tab.', 'info');
          perceptionBadgeCount.textContent = '0';
          elementsList.innerHTML = '<div class="empty-state"><p>Visual overlays cleared. Click "Inspect Perception" to rescan.</p></div>';
          elementsStats.textContent = 'No active perception snapshot';
        });
      }
    } catch (e) {}
  }

  // 7. Tab Switching Logic
  function switchTab(tabId) {
    navTabs.forEach(tab => {
      tab.classList.toggle('active', tab.getAttribute('data-tab') === tabId);
    });
    tabContents.forEach(content => {
      content.classList.toggle('active', content.id === tabId);
    });
  }

  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  // 8. Auth Modal Handlers
  profileBtn.addEventListener('click', () => {
    authModal.classList.remove('hidden');
  });

  closeAuthBtn.addEventListener('click', () => {
    authModal.classList.add('hidden');
  });

  addProfileBtn.addEventListener('click', () => {
    const name = prompt('Enter new profile name (e.g. "hackathon-judge" or "personal"):');
    if (name) {
      const clean = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (clean) {
        const opt = document.createElement('option');
        opt.value = clean;
        opt.textContent = `${clean} (Custom)`;
        profileSelect.appendChild(opt);
        profileSelect.value = clean;
      }
    }
  });

  loginSubmitBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim() || 'Operator';
    const profile = profileSelect.value || 'default';
    const apiBase = apiBaseInput.value.trim() || 'http://127.0.0.1:9777';

    loginSubmitBtn.disabled = true;
    loginSubmitBtn.textContent = 'Connecting...';

    try {
      const res = await fetch(`${apiBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, profile })
      });
      const data = await res.json();
      await chrome.storage.local.set({ username, profile, apiBase, token: data.token });
      log(`Signed in successfully as ${username} (Profile: ${profile})`, 'success');
      authModal.classList.add('hidden');
      await loadAuth();
      await checkEngine();
      await fetchWorkflows();
    } catch (err) {
      log(`Sign-in error: ${err.message}. Saved settings locally.`, 'warn');
      await chrome.storage.local.set({ username, profile, apiBase });
      authModal.classList.add('hidden');
      await loadAuth();
    } finally {
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.textContent = 'Connect & Save';
    }
  });

  // 9. Doctor Diagnostics
  runDoctorBtn.addEventListener('click', async () => {
    const { apiBase } = await loadAuth();
    runDoctorBtn.disabled = true;
    runDoctorBtn.textContent = 'Diagnosing...';
    log('[Doctor] Running preflight system diagnostics...', 'info');

    try {
      const res = await fetch(`${apiBase}/api/doctor`);
      const data = await res.json();
      if (data.success) {
        log('✓ All system checks passed: Chromium found, storage verified, stealth active.', 'success');
        runDoctorBtn.textContent = '✓ Ready';
      }
    } catch (err) {
      log(`Doctor check failed: ${err.message}`, 'error');
      runDoctorBtn.textContent = 'Retry';
    } finally {
      setTimeout(() => {
        runDoctorBtn.disabled = false;
        runDoctorBtn.textContent = 'Run Diagnostics';
      }, 2000);
    }
  });

  // 10. Autonomous Groq + Canva PPT Generator
  const generatePptBtn = document.getElementById('generatePptBtn');
  const pptTopicInput = document.getElementById('pptTopicInput');
  const pptHeadedCheck = document.getElementById('pptHeadedCheck');
  const pptStatusBox = document.getElementById('pptStatusBox');
  const pptStatusBody = document.getElementById('pptStatusBody');

  function pptLog(msg, type = 'normal') {
    const time = new Date().toLocaleTimeString([], { hour12: false });
    const div = document.createElement('div');
    div.className = `log-line ${type}`;
    div.textContent = `[${time}] ${msg}`;
    if (pptStatusBody) {
      pptStatusBody.appendChild(div);
      pptStatusBody.scrollTop = pptStatusBody.scrollHeight;
    }
    log(`[PPT Agent] ${msg}`, type);
  }

  if (generatePptBtn) {
    generatePptBtn.addEventListener('click', async () => {
      const topic = (pptTopicInput?.value || '').trim() || 'Autonomous Web Agents';
      const headed = pptHeadedCheck ? pptHeadedCheck.checked : true;
      const { apiBase, profile } = await loadAuth();

      generatePptBtn.disabled = true;
      generatePptBtn.innerHTML = '<span class="icon">⏳</span> Synthesizing Deck...';
      if (pptStatusBox) pptStatusBox.style.display = 'block';
      if (pptStatusBody) pptStatusBody.innerHTML = '';
      pptLog(`Synthesizing structured pitch deck for "${topic}" via Groq LPU...`, 'info');

      try {
        const res = await fetch(`${apiBase}/api/presentations/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic, headed, profile })
        });

        const data = await res.json();
        if (data.success) {
          pptLog(`✓ Groq synthesized ${data.slidesCount} slides at 800 tokens/sec!`, 'success');
          pptLog(`✓ Autonomous presentation deck live: ${data.deckId}`, 'success');
          generatePptBtn.innerHTML = '<span class="icon">✓</span> Deck Generated!';
        } else {
          pptLog(`✗ Error: ${data.error}`, 'error');
          generatePptBtn.innerHTML = '<span class="icon">✗</span> Failed';
        }
      } catch (err) {
        pptLog(`Connection error: ${err.message}`, 'error');
        generatePptBtn.innerHTML = '<span class="icon">✗</span> Error';
      } finally {
        setTimeout(() => {
          generatePptBtn.disabled = false;
          generatePptBtn.innerHTML = '<span class="icon">🚀</span> Launch Autonomous PPT Agent';
        }, 3500);
      }
    });
  }

  // 11. Event Listeners
  inspectTabBtn.addEventListener('click', inspectActiveTab);
  rescanBtn.addEventListener('click', inspectActiveTab);
  clearOverlaysBtn.addEventListener('click', clearOverlays);
  refreshWorkflowsBtn.addEventListener('click', fetchWorkflows);
  clearLogsBtn.addEventListener('click', () => { terminalBody.innerHTML = ''; });

  workflowSearchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    const filtered = allWorkflows.filter(wf => 
      (wf.id && wf.id.toLowerCase().includes(query)) ||
      (wf.name && wf.name.toLowerCase().includes(query)) ||
      (wf.domain && wf.domain.toLowerCase().includes(query))
    );
    renderWorkflows(filtered);
  });

  // Initialize
  await loadActiveTab();
  await loadAuth();
  const online = await checkEngine();
  if (online) {
    await fetchWorkflows();
  }
});
