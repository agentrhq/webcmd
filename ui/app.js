const $ = (id) => document.getElementById(id);
const goal = $('goal');
const timeline = $('timeline');
const state = $('activityState');
const resultPanel = $('resultPanel');
const result = $('result');
let running = false;

function log(message, detail = '') {
  if (timeline.querySelector('.empty-state')) timeline.innerHTML = '';
  const row = document.createElement('div');
  row.className = 'event';
  row.innerHTML = `<span class="event-dot"></span><div>${escapeHtml(message)}<small>${escapeHtml(detail || new Date().toLocaleTimeString())}</small></div>`;
  timeline.appendChild(row);
  timeline.scrollTop = timeline.scrollHeight;
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c])); }
function options() { return { goal: goal.value.trim(), profile: $('profile').value.trim() || 'default', session: $('session').value.trim(), model: $('model').value.trim() }; }
async function request(path, payload) {
  const response = await fetch(path, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Workflow request failed');
  return data;
}
async function preview() {
  if (!goal.value.trim() || running) return;
  running = true; state.textContent = 'Planning'; state.className = 'pill running'; log('Asking Gemini for a workflow plan');
  try { const data = await request('/api/plan', options()); resultPanel.classList.remove('hidden'); result.textContent = JSON.stringify(data.workflow, null, 2); log(`${data.workflow.steps.length} steps validated`, 'Plan ready'); state.textContent = 'Plan ready'; state.className = 'pill done'; }
  catch (error) { log(error.message, 'Error'); state.textContent = 'Error'; }
  finally { running = false; }
}
async function run() {
  if (!goal.value.trim() || running) return;
  running = true; state.textContent = 'Running'; state.className = 'pill running'; log('Planning workflow', 'Gemini');
  try { const data = await request('/api/run', options()); resultPanel.classList.remove('hidden'); result.textContent = JSON.stringify(data, null, 2); log('Workflow completed', 'Browser result received'); state.textContent = 'Complete'; state.className = 'pill done'; }
  catch (error) { log(error.message, 'Workflow stopped'); state.textContent = 'Error'; state.className = 'pill'; resultPanel.classList.remove('hidden'); result.textContent = error.stack || error.message; }
  finally { running = false; }
}
$('preview').addEventListener('click', preview); $('run').addEventListener('click', run); $('clear').addEventListener('click', () => { resultPanel.classList.add('hidden'); result.textContent = ''; });
document.querySelectorAll('[data-goal]').forEach(button => button.addEventListener('click', () => { goal.value = button.dataset.goal; goal.focus(); }));
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') { event.preventDefault(); preview(); } });
