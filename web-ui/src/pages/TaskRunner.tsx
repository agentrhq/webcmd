import React, { useState } from 'react';
import {
  Play,
  RotateCw,
  Globe,
  Layers,
  Sparkles,
  Terminal,
  Code2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Database,
  ExternalLink,
  ChevronDown,
  Copy,
  Check,
} from 'lucide-react';
import { api } from '../api';
import { LearningStepper, type LearningPhase } from '../components/LearningStepper';
import type { BrowserSession, TaskExecutionResponse } from '../types';

interface TaskRunnerProps {
  sessions: BrowserSession[];
  initialUrl?: string;
  initialTask?: string;
  onRefreshSessions: () => void;
}

export const TaskRunner: React.FC<TaskRunnerProps> = ({
  sessions,
  initialUrl = 'https://www.amazon.in',
  initialTask = 'Find Samsung Galaxy phone on Amazon',
  onRefreshSessions,
}) => {
  const [url, setUrl] = useState(initialUrl);
  const [task, setTask] = useState(initialTask);
  const [selectedSession, setSelectedSession] = useState<string>(
    sessions.find((s) => s.runtimeState === 'active')?.id || sessions[0]?.id || ''
  );
  const [newSessionName, setNewSessionName] = useState('');
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  // Execution states
  const [isRunning, setIsRunning] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<LearningPhase>('IDLE');
  const [taskResponse, setTaskResponse] = useState<TaskExecutionResponse | null>(null);
  const [replayResult, setReplayResult] = useState<{ durationMs: number; items?: any[] } | null>(null);
  const [activeTab, setActiveTab] = useState<'results' | 'locators' | 'memory' | 'logs' | 'script'>('results');
  const [copiedLocator, setCopiedLocator] = useState<string | null>(null);

  const presets = [
    {
      name: 'Amazon Samsung Search',
      url: 'https://www.amazon.in',
      task: 'Find Samsung Galaxy phone on Amazon',
    },
    {
      name: 'Hacker News Top Stories',
      url: 'https://news.ycombinator.com',
      task: 'Find the top stories on Hacker News',
    },
    {
      name: 'GitHub Webcmd Search',
      url: 'https://github.com/search?q=webcmd',
      task: 'Search GitHub for a repository',
    },
    {
      name: 'Wikipedia Python Summary',
      url: 'https://en.wikipedia.org/wiki/Python_(programming_language)',
      task: 'Extract summary of Python programming language',
    },
  ];

  const handleCreateSession = async () => {
    if (!newSessionName.trim()) return;
    try {
      const res = await api.createSession(newSessionName.trim());
      onRefreshSessions();
      setSelectedSession(res.session.id);
      setNewSessionName('');
      setIsCreatingSession(false);
    } catch (err: any) {
      alert(`Could not create session: ${err.message}`);
    }
  };

  const handleRunTask = async () => {
    if (!url.trim() || !task.trim() || isRunning) return;

    setIsRunning(true);
    setReplayResult(null);
    setTaskResponse(null);

    // Progression animation through phases
    setCurrentPhase('DISCOVER');
    const phaseTimer1 = setTimeout(() => setCurrentPhase('OBSERVE'), 1200);
    const phaseTimer2 = setTimeout(() => setCurrentPhase('LEARN'), 2600);
    const phaseTimer3 = setTimeout(() => setCurrentPhase('VALIDATE'), 4200);
    const phaseTimer4 = setTimeout(() => setCurrentPhase('CHECKPOINT'), 5800);

    try {
      const response = await api.executeTask({
        url: url.trim(),
        task: task.trim(),
        session: selectedSession || undefined,
      });

      clearTimeout(phaseTimer1);
      clearTimeout(phaseTimer2);
      clearTimeout(phaseTimer3);
      clearTimeout(phaseTimer4);

      setCurrentPhase('REUSE');
      setTimeout(() => setCurrentPhase('COMPLETED'), 800);

      setTaskResponse(response);
      if (!selectedSession && response.session) {
        setSelectedSession(response.session);
        onRefreshSessions();
      }
    } catch (err: any) {
      clearTimeout(phaseTimer1);
      clearTimeout(phaseTimer2);
      clearTimeout(phaseTimer3);
      clearTimeout(phaseTimer4);
      setCurrentPhase('IDLE');
      alert(`Task Execution Notice: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handleReplay = async () => {
    if (!taskResponse?.workflow && !task) return;
    setIsReplaying(true);
    try {
      const res = await api.replayTask({
        session: selectedSession || taskResponse?.session,
        workflowId: taskResponse?.workflow?.id,
        script: taskResponse?.workflow?.script,
      });
      setReplayResult({
        durationMs: res.durationMs,
        items: res.result?.items || taskResponse?.extractedItems,
      });
    } catch (err: any) {
      alert(`Replay Error: ${err.message}`);
    } finally {
      setIsReplaying(false);
    }
  };

  const handleCopyLocator = (val: string, key: string) => {
    navigator.clipboard.writeText(val);
    setCopiedLocator(key);
    setTimeout(() => setCopiedLocator(null), 2000);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Universal Task Input Card */}
      <div className="glass-panel rounded-3xl p-6 border border-slate-700/80 bg-gradient-to-b from-[#0e1628]/90 to-[#0a0f1c]/90">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-black shadow-lg shadow-cyan-500/20">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Universal Website Task Engine</h2>
              <p className="text-xs text-slate-400">Autonomous browser execution, selector learning & memory storage</p>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="hidden sm:flex items-center space-x-1.5">
            <span className="text-[11px] font-mono text-slate-500 mr-1">Presets:</span>
            {presets.map((p, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setUrl(p.url);
                  setTask(p.task);
                }}
                className="px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 font-medium text-xs transition border border-slate-700/70"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        {/* Inputs Form */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* Target URL */}
          <div className="md:col-span-5 space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-cyan-400" />
              <span>Target Website URL</span>
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.amazon.in or any website..."
              className="w-full px-4 py-2.5 rounded-xl bg-slate-900/80 border border-slate-700/80 text-white font-mono text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition"
            />
          </div>

          {/* Task Intent */}
          <div className="md:col-span-4 space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              <span>Natural Language Task</span>
            </label>
            <input
              type="text"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="e.g. Find Samsung Galaxy phone on Amazon..."
              className="w-full px-4 py-2.5 rounded-xl bg-slate-900/80 border border-slate-700/80 text-white text-xs focus:outline-none focus:border-purple-400 focus:ring-1 focus:ring-purple-400 transition"
            />
          </div>

          {/* Session Selector */}
          <div className="md:col-span-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                <span>Webcmd Session</span>
              </label>
              <button
                onClick={() => setIsCreatingSession(!isCreatingSession)}
                className="text-[10px] text-cyan-400 hover:text-cyan-300"
              >
                {isCreatingSession ? 'Select' : '+ New'}
              </button>
            </div>

            {isCreatingSession ? (
              <div className="flex space-x-1">
                <input
                  type="text"
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  placeholder="session-name"
                  className="w-full px-3 py-2 rounded-xl bg-slate-900/80 border border-slate-700/80 text-white text-xs font-mono"
                />
                <button
                  onClick={handleCreateSession}
                  className="px-3 py-2 rounded-xl bg-cyan-500 text-black font-semibold text-xs whitespace-nowrap"
                >
                  Create
                </button>
              </div>
            ) : (
              <select
                value={selectedSession}
                onChange={(e) => setSelectedSession(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900/80 border border-slate-700/80 text-white font-mono text-xs focus:outline-none focus:border-cyan-400 transition"
              >
                <option value="">Auto-allocate Session</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id} {s.runtimeState === 'active' ? '🟢 active' : '⚪ idle'}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center space-x-2 text-xs text-slate-400">
            <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
            <span>Real Playwright execution via Webcmd CDP daemon</span>
          </div>

          <div className="flex items-center space-x-3">
            {taskResponse?.workflow && (
              <button
                onClick={handleReplay}
                disabled={isReplaying || isRunning}
                className="flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-purple-600/90 hover:bg-purple-500 text-white font-semibold text-xs transition disabled:opacity-50 shadow-md shadow-purple-600/20"
              >
                <RotateCw className={`w-3.5 h-3.5 ${isReplaying ? 'animate-spin' : ''}`} />
                <span>Replay Learned Workflow</span>
              </button>
            )}

            <button
              onClick={handleRunTask}
              disabled={isRunning || !url.trim() || !task.trim()}
              className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs transition disabled:opacity-50 shadow-lg shadow-cyan-500/25 hover:scale-[1.02] active:scale-[0.98]"
            >
              <Play className={`w-3.5 h-3.5 fill-current ${isRunning ? 'animate-pulse' : ''}`} />
              <span>{isRunning ? 'Executing Real Browser Actions...' : 'Run Task & Learn'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Learning Stepper Component */}
      <LearningStepper currentPhase={currentPhase} durationMs={taskResponse?.durationMs} />

      {/* Replay Metric Card (when Replayed) */}
      {replayResult && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-500/15 via-indigo-500/10 to-transparent border border-purple-500/30 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-300">
              <RotateCw className="w-4 h-4" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">Deterministic Workflow Replayed Successfully</h4>
              <p className="text-xs text-slate-300">
                Executed discovered locators with zero discovery overhead.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-4 font-mono text-xs">
            <div>
              <span className="text-[10px] text-slate-400 uppercase block">Initial Learning</span>
              <span className="text-slate-300 font-bold">{((taskResponse?.durationMs || 4500) / 1000).toFixed(2)}s</span>
            </div>
            <div className="text-emerald-400 font-bold">→</div>
            <div>
              <span className="text-[10px] text-purple-400 uppercase block">Replay Duration</span>
              <span className="text-purple-300 font-extrabold text-sm">{(replayResult.durationMs / 1000).toFixed(2)}s</span>
            </div>
          </div>
        </div>
      )}

      {/* Live Output, Locators & Results Section */}
      {taskResponse && (
        <div className="glass-panel rounded-3xl border border-slate-800 overflow-hidden">
          {/* Tabs Bar */}
          <div className="h-13 px-6 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
            <div className="flex items-center space-x-1">
              {[
                { id: 'results', label: `Extracted Results (${taskResponse.extractedItems.length})`, icon: CheckCircle2 },
                { id: 'locators', label: 'Discovered Locators', icon: Code2 },
                { id: 'memory', label: 'Site Memory Diff', icon: Database },
                { id: 'logs', label: `Live Activity Logs (${taskResponse.logs.length})`, icon: Terminal },
                { id: 'script', label: 'Playwright Script', icon: Code2 },
              ].map((tab) => {
                const Icon = tab.icon;
                const isSelected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex items-center space-x-2 px-3.5 py-3 text-xs font-semibold border-b-2 transition ${
                      isSelected
                        ? 'border-cyan-400 text-cyan-300 bg-cyan-500/5'
                        : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="text-xs text-slate-400 font-mono flex items-center space-x-2">
              <span className="text-slate-500">Session:</span>
              <span className="text-cyan-400">{taskResponse.session}</span>
            </div>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {/* Tab 1: Extracted Results */}
            {activeTab === 'results' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-semibold text-white">
                    Verified Product / Content Elements from {taskResponse.domain}
                  </span>
                  <span className="font-mono">{taskResponse.extractedItems.length} items extracted</span>
                </div>

                {taskResponse.extractedItems.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs">
                    Page action executed. Title: "{taskResponse.page.title}". Check locators tab to inspect discovered elements.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {taskResponse.extractedItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-slate-700 transition space-y-2 flex flex-col justify-between"
                      >
                        <div>
                          <div className="text-xs font-bold text-slate-100 line-clamp-2">
                            {item.title || item.name || 'Extracted Item'}
                          </div>

                          {item.price && (
                            <div className="mt-2 text-sm font-extrabold text-emerald-400 font-mono">
                              {item.price}
                            </div>
                          )}

                          {item.score && (
                            <div className="mt-2 text-xs font-semibold text-amber-400 font-mono">
                              {item.score}
                            </div>
                          )}

                          {item.rating && (
                            <div className="text-[11px] text-slate-400 mt-1">
                              {item.rating}
                            </div>
                          )}
                        </div>

                        {item.link || item.url ? (
                          <div className="pt-2 border-t border-slate-800/80 flex justify-end">
                            <a
                              href={item.link || item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-cyan-400 hover:underline flex items-center space-x-1"
                            >
                              <span>View Source</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: Discovered Locators */}
            {activeTab === 'locators' && (
              <div className="space-y-4">
                <div className="text-xs text-slate-400">
                  Resilient CSS/DOM locators discovered on the live page and verified for reuse:
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {Object.entries(taskResponse.discoveredLocators).map(([key, val]) => (
                    <div
                      key={key}
                      className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between"
                    >
                      <div className="min-w-0 pr-3">
                        <span className="text-[11px] text-slate-500 font-mono block uppercase">{key}</span>
                        <span className="text-xs font-mono text-cyan-300 truncate block mt-0.5">{val}</span>
                      </div>

                      <button
                        onClick={() => handleCopyLocator(val, key)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        title="Copy locator"
                      >
                        {copiedLocator === key ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab 3: Site Memory Diff */}
            {activeTab === 'memory' && (
              <div className="space-y-4">
                <div className="text-xs text-slate-400 flex items-center justify-between">
                  <span>Persisted Record in <code className="text-cyan-400 font-mono">~/.webcmd/sites/{taskResponse.domain}/notes.md</code></span>
                  <span className="text-emerald-400 text-[11px] font-mono">✓ Committed to Site Memory</span>
                </div>

                <pre className="p-4 rounded-xl bg-[#080b12] border border-slate-800 font-mono text-xs text-slate-200 whitespace-pre-wrap leading-relaxed overflow-x-auto">
                  {taskResponse.savedSiteMemory.note}
                </pre>
              </div>
            )}

            {/* Tab 4: Logs */}
            {activeTab === 'logs' && (
              <div className="space-y-2 font-mono text-xs">
                {taskResponse.logs.map((log, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-lg bg-slate-900/60 border border-slate-800/80 flex items-start space-x-3"
                  >
                    <span className="text-[10px] text-slate-500">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.2 rounded ${
                        log.stage === 'DISCOVER'
                          ? 'bg-blue-500/10 text-blue-400'
                          : log.stage === 'OBSERVE'
                          ? 'bg-cyan-500/10 text-cyan-400'
                          : log.stage === 'LEARN'
                          ? 'bg-purple-500/10 text-purple-400'
                          : log.stage === 'VALIDATE'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-amber-500/10 text-amber-400'
                      }`}
                    >
                      {log.stage}
                    </span>
                    <span className="text-slate-300 flex-1">{log.message}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Tab 5: Playwright Replay Script */}
            {activeTab === 'script' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Self-contained Playwright snippet ready for Webcmd CLI execution:</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(taskResponse.workflow.script);
                      alert('Replay script copied to clipboard!');
                    }}
                    className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center space-x-1"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy Script</span>
                  </button>
                </div>

                <pre className="p-4 rounded-xl bg-[#080b12] border border-slate-800 font-mono text-xs text-cyan-300 whitespace-pre-wrap leading-relaxed overflow-x-auto">
                  {taskResponse.workflow.script}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
