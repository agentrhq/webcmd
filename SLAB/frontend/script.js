(() => {
  const form = document.getElementById('research-form');
  const submitBtn = document.getElementById('submit-btn');
  const btnLabel = submitBtn.querySelector('.btn-label');

  const intakePanel = document.getElementById('intake-panel');
  const loadingPanel = document.getElementById('loading-panel');
  const errorPanel = document.getElementById('error-panel');
  const errorMessage = document.getElementById('error-message');
  const resultsSection = document.getElementById('results-section');
  const retryBtn = document.getElementById('retry-btn');

  const progressItems = Array.from(document.querySelectorAll('#progress-list li'));

  const summaryText = document.getElementById('summary-text');
  const actionsList = document.getElementById('actions-list');
  const resultsTbody = document.getElementById('results-tbody');
  const sourcesList = document.getElementById('sources-list');

  const API_ENDPOINT = '/research';

  let progressTimer = null;

  function showPanel(el) { el.hidden = false; }
  function hidePanel(el) { el.hidden = true; }

  function resetProgressUI() {
    progressItems.forEach(li => li.classList.remove('active', 'done'));
  }

  // Step through the progress list while the request is in flight.
  // If the response comes back before the animation finishes, we
  // immediately mark everything done in advance() on completion.
  function startProgressAnimation() {
    resetProgressUI();
    let index = 0;
    const advance = () => {
      progressItems.forEach((li, i) => {
        li.classList.toggle('active', i === index);
        li.classList.toggle('done', i < index);
      });
      if (index < progressItems.length - 1) {
        index += 1;
        progressTimer = setTimeout(advance, 1600);
      }
    };
    advance();
  }

  function stopProgressAnimation() {
    if (progressTimer) {
      clearTimeout(progressTimer);
      progressTimer = null;
    }
    progressItems.forEach(li => {
      li.classList.add('done');
      li.classList.remove('active');
    });
  }

  function setSubmitting(isSubmitting) {
    submitBtn.disabled = isSubmitting;
    btnLabel.textContent = isSubmitting ? 'Investigating…' : 'Start Research';
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isLikelyUrl(str) {
    if (!str) return false;
    try {
      const u = new URL(str);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function renderEligibilityPill(value) {
    const v = String(value ?? '').toLowerCase();
    if (v === 'true' || v === 'yes' || v === 'eligible') {
      return '<span class="eligible-pill">Eligible</span>';
    }
    if (v === 'false' || v === 'no' || v === 'not eligible' || v === 'ineligible') {
      return '<span class="not-eligible-pill">Not eligible</span>';
    }
    return `<span class="unclear-pill">${escapeHtml(value || 'Unclear')}</span>`;
  }

  function isEligibleValue(value) {
    const v = String(value ?? '').toLowerCase();
    return v === 'true' || v === 'yes' || v === 'eligible';
  }

  function renderResults(data) {
    // Summary
    summaryText.textContent = data.summary || 'The investigation is complete. See the findings below.';

    // Next actions
    const actions = data.next_3_actions || data.next_actions || data.nextActions || data.actions || [];
    actionsList.innerHTML = '';
    if (actions.length === 0) {
      const li = document.createElement('li');
      li.innerHTML = '<span class="action-text">No specific actions were identified. Review the opportunities table below.</span>';
      actionsList.appendChild(li);
    } else {
      actions.slice(0, 3).forEach(action => {
        const li = document.createElement('li');
        li.innerHTML = `<span class="action-text">${escapeHtml(action)}</span>`;
        actionsList.appendChild(li);
      });
    }

    // Opportunities table
    const opportunities = data.opportunities || data.results || [];
    resultsTbody.innerHTML = '';
    if (opportunities.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="5">No opportunities were found for this task. Try broadening the search.</td>';
      resultsTbody.appendChild(tr);
    } else {
      opportunities.forEach(op => {
        const name = op.name || op.opportunity || op.title || 'Untitled opportunity';
        const eligible = op.eligible ?? op.eligibility;
        const deadline = op.deadline || 'Not specified';
        const action = op.action || op.what_to_do || op.next_step || '—';
        const source = op.source || op.source_url || op.url || '';

        const tr = document.createElement('tr');
        if (isEligibleValue(eligible)) tr.classList.add('eligible-row');

        const sourceCell = isLikelyUrl(source)
          ? `<a class="source-link" href="${escapeHtml(source)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source)}</a>`
          : escapeHtml(source || 'Not provided');

        tr.innerHTML = `
          <td class="opportunity-cell">${escapeHtml(name)}</td>
          <td>${renderEligibilityPill(eligible)}</td>
          <td>${escapeHtml(deadline)}</td>
          <td>${escapeHtml(action)}</td>
          <td>${sourceCell}</td>
        `;
        resultsTbody.appendChild(tr);
      });
    }

    // Sources checked
    const sources = data.sources || data.sources_checked || data.sourcesChecked || [];
    sourcesList.innerHTML = '';
    if (sources.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No source list was returned.';
      sourcesList.appendChild(li);
    } else {
      sources.forEach(src => {
        const li = document.createElement('li');
        if (isLikelyUrl(src)) {
          li.innerHTML = `<a href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src)}</a>`;
        } else {
          li.textContent = src;
        }
        sourcesList.appendChild(li);
      });
    }
  }

  function showError(message) {
    errorMessage.textContent = message || 'Something interrupted the investigation. Please try again.';
    hidePanel(loadingPanel);
    hidePanel(resultsSection);
    showPanel(errorPanel);
    showPanel(intakePanel);
  }

  async function runResearch(payload) {
    stopProgressAnimation(); // clear any stale timers first
    resetProgressUI();
    hidePanel(errorPanel);
    hidePanel(resultsSection);
    hidePanel(intakePanel);
    showPanel(loadingPanel);
    setSubmitting(true);
    startProgressAnimation();

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let detail = '';
        try {
          const errJson = await response.json();
          detail = errJson.detail || errJson.message || '';
        } catch {
          /* ignore parse errors on error body */
        }
        throw new Error(detail || `The research service returned an error (${response.status}).`);
      }

      const data = await response.json();
      stopProgressAnimation();

      // brief pause so the final "done" state is visible before switching views
      await new Promise(r => setTimeout(r, 350));

      renderResults(data);
      hidePanel(loadingPanel);
      showPanel(resultsSection);
    } catch (err) {
      stopProgressAnimation();
      showError(
        err && err.message
          ? err.message
          : 'Could not reach the research service. Check your connection and try again.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const task = document.getElementById('task').value.trim();
    if (!task) return;

    const payload = {
      task,
      profile: {
        year: document.getElementById('year').value || null,
        branch: document.getElementById('branch').value.trim() || null,
        interests: document.getElementById('interests').value.trim() || null,
      },
    };

    runResearch(payload);
  });

  retryBtn.addEventListener('click', () => {
    hidePanel(errorPanel);
    showPanel(intakePanel);
  });
})();
