import React, { useState } from 'react';
import { Layers, Plus, Trash2, ExternalLink, RefreshCw, Eye, X, Camera, Clock } from 'lucide-react';
import { api } from '../api';
import type { BrowserSession } from '../types';

interface SessionsPageProps {
  sessions: BrowserSession[];
  onRefresh: () => void;
  onSelectSession?: (id: string) => void;
}

export const SessionsPage: React.FC<SessionsPageProps> = ({
  sessions,
  onRefresh,
  onSelectSession,
}) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [inspectSession, setInspectSession] = useState<string | null>(null);
  const [tabs, setTabs] = useState<any[]>([]);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [isLoadingInspect, setIsLoadingInspect] = useState(false);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'idle'>('all');

  const handleCreate = async () => {
    if (!newSessionName.trim()) return;
    try {
      await api.createSession(newSessionName.trim());
      setNewSessionName('');
      setIsCreating(false);
      onRefresh();
    } catch (err: any) {
      alert(`Failed to create session: ${err.message}`);
    }
  };

  const handleClose = async (id: string) => {
    if (!confirm(`Are you sure you want to close session ${id}?`)) return;
    try {
      await api.closeSession(id);
      if (inspectSession === id) setInspectSession(null);
      onRefresh();
    } catch (err: any) {
      alert(`Could not close session: ${err.message}`);
    }
  };

  const handleInspect = async (id: string) => {
    setInspectSession(id);
    setIsLoadingInspect(true);
    setTabs([]);
    setSnapshot(null);

    try {
      const [tabsRes, snapRes] = await Promise.all([
        api.getSessionTabs(id).catch(() => ({ ok: false, tabs: [] })),
        api.getSessionSnapshot(id, 'act').catch(() => ({ ok: false, snapshot: null })),
      ]);
      setTabs(tabsRes.tabs || []);
      setSnapshot(snapRes.snapshot);
    } catch {
      // ignore
    } finally {
      setIsLoadingInspect(false);
    }
  };

  const filtered = sessions.filter((s) => {
    if (filterState === 'active') return s.runtimeState === 'active';
    if (filterState === 'idle') return s.runtimeState === 'idle';
    return true;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-400" />
            <span>Browser Sessions</span>
          </h2>
          <p className="text-xs text-slate-400">
            Real Webcmd managed sessions, active Playwright browser contexts, and CDP bindings
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {/* State Filter Buttons */}
          <div className="flex p-1 rounded-xl bg-slate-900 border border-slate-800 text-xs">
            {(['all', 'active', 'idle'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setFilterState(filter)}
                className={`px-3 py-1 rounded-lg capitalize transition ${
                  filterState === filter
                    ? 'bg-slate-800 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>

          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs transition shadow-md shadow-cyan-500/20"
          >
            <Plus className="w-4 h-4" />
            <span>New Session</span>
          </button>
        </div>
      </div>

      {/* New Session Form Drawer / Modal */}
      {isCreating && (
        <div className="p-5 rounded-2xl glass-panel border border-cyan-500/40 bg-slate-900/80 animate-slide-up flex items-center justify-between gap-4">
          <div className="flex-1 max-w-md space-y-1">
            <label className="text-xs font-semibold text-slate-200">New Session Identifier</label>
            <input
              type="text"
              value={newSessionName}
              onChange={(e) => setNewSessionName(e.target.value)}
              placeholder="e.g. amazon-browser, github-crawler, test-run"
              className="w-full px-3.5 py-2 rounded-xl bg-slate-800 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-cyan-400"
              autoFocus
            />
          </div>
          <div className="flex items-center space-x-2 pt-5">
            <button
              onClick={() => setIsCreating(false)}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs"
            >
              Create Session
            </button>
          </div>
        </div>
      )}

      {/* Sessions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((s) => (
          <div
            key={s.id}
            className={`glass-panel glass-panel-hover rounded-2xl p-5 border transition flex flex-col justify-between ${
              inspectSession === s.id ? 'border-cyan-400 ring-1 ring-cyan-500/30' : 'border-slate-800'
            }`}
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase tracking-wider ${
                    s.runtimeState === 'active'
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {s.runtimeState}
                </span>

                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => handleInspect(s.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition"
                    title="Inspect session tabs & snapshot"
                  >
                    <Eye className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleClose(s.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition"
                    title="Close session"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <h3 className="text-sm font-bold text-white font-mono truncate" title={s.id}>
                {s.id}
              </h3>

              <div className="mt-3 space-y-1.5 text-xs text-slate-400 font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">Profile:</span>
                  <span className="text-slate-300">{s.profileId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Kind:</span>
                  <span className="text-slate-300">{s.kind}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Last Used:</span>
                  <span className="text-slate-300">{new Date(s.lastUsedAt).toLocaleTimeString()}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between">
              <span className="text-[10px] text-slate-500 font-mono">
                {new Date(s.createdAt).toLocaleDateString()}
              </span>

              {onSelectSession && (
                <button
                  onClick={() => onSelectSession(s.id)}
                  className="text-xs font-semibold text-cyan-400 hover:underline flex items-center space-x-1"
                >
                  <span>Select</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Inspect Session Drawer */}
      {inspectSession && (
        <div className="glass-panel rounded-3xl p-6 border border-cyan-500/30 bg-slate-900/90 space-y-5 animate-slide-up">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <Camera className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white font-mono">Live Inspection: {inspectSession}</h3>
            </div>
            <button
              onClick={() => setInspectSession(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {isLoadingInspect ? (
            <div className="py-12 flex flex-col items-center justify-center text-cyan-400 space-y-2">
              <RefreshCw className="w-6 h-6 animate-spin" />
              <span className="text-xs font-mono">Querying Webcmd CDP for session state...</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Tabs */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Open Tabs ({tabs.length})</h4>
                {tabs.length === 0 ? (
                  <p className="text-xs text-slate-500">No active browser tabs in this session.</p>
                ) : (
                  <div className="space-y-2">
                    {tabs.map((tab: any, idx: number) => (
                      <div key={idx} className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs font-mono">
                        <div className="font-semibold text-cyan-300 truncate">{tab.title || 'Untitled'}</div>
                        <div className="text-slate-400 text-[11px] truncate mt-0.5">{tab.url}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Snapshot Preview */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Accessibility Snapshot</h4>
                {snapshot ? (
                  <pre className="p-3 rounded-xl bg-[#080b12] border border-slate-800 font-mono text-[11px] text-slate-300 max-h-60 overflow-y-auto leading-relaxed">
                    {typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot, null, 2)}
                  </pre>
                ) : (
                  <p className="text-xs text-slate-500">No active snapshot data available.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
