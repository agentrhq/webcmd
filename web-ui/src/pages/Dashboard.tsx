import React from 'react';
import {
  Layers,
  Globe,
  GitBranch,
  Search,
  Play,
  ArrowRight,
  ShieldCheck,
  Cpu,
  Terminal,
  ExternalLink,
  Sparkles,
} from 'lucide-react';
import type { HealthResponse, BrowserSession, SiteSummary, StoredWorkflow } from '../types';

interface DashboardProps {
  health?: HealthResponse;
  sessions: BrowserSession[];
  sites: SiteSummary[];
  workflows: StoredWorkflow[];
  onNavigate: (page: string) => void;
  onLaunchTask: (url: string, task: string) => void;
  onOpenTerminal: (cmd?: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  health,
  sessions,
  sites,
  workflows,
  onNavigate,
  onLaunchTask,
  onOpenTerminal,
}) => {
  const activeSessions = sessions.filter((s) => s.runtimeState === 'active');

  const demoPresets = [
    {
      title: 'Find Samsung Galaxy phones on Amazon',
      url: 'https://www.amazon.in',
      task: 'Find Samsung Galaxy phone on Amazon',
      category: 'E-Commerce Demo',
      color: 'from-amber-500/20 to-orange-500/20 border-orange-500/30 text-orange-400',
    },
    {
      title: 'Top stories from Hacker News',
      url: 'https://news.ycombinator.com',
      task: 'Find the top stories on Hacker News',
      category: 'Content Extraction',
      color: 'from-cyan-500/20 to-blue-500/20 border-cyan-500/30 text-cyan-400',
    },
    {
      title: 'Search GitHub Repositories',
      url: 'https://github.com/search?q=webcmd',
      task: 'Search GitHub for a repository',
      category: 'Code Search',
      color: 'from-purple-500/20 to-indigo-500/20 border-purple-500/30 text-purple-400',
    },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Hero Welcome & Quick Start Banner */}
      <div className="relative overflow-hidden rounded-3xl p-8 glass-panel border border-slate-700/60 bg-gradient-to-br from-[#0e1628] via-[#0d1322] to-[#070a12]">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-48 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-mono font-medium mb-4">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>Autonomous Webcmd Learning Engine • 2026 Edition</span>
          </div>

          <h2 className="text-3xl font-black text-white tracking-tight leading-tight">
            Turn Any Website Into a <span className="text-gradient">Deterministic CLI Surface</span>
          </h2>

          <p className="text-slate-300 text-sm mt-3 leading-relaxed">
            Execute real browser actions across any website, automatically discover resilient locators, persist site
            memory notes and schemas, and replay learned workflows with zero flakiness.
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={() => onNavigate('runner')}
              className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-sm transition shadow-lg shadow-cyan-500/25 hover:scale-[1.02] active:scale-[0.98]"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Launch Universal Task Runner</span>
            </button>

            <button
              onClick={() => onOpenTerminal('webcmd doctor')}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700 text-sm font-medium transition"
            >
              <Terminal className="w-4 h-4 text-cyan-400" />
              <span>Run Doctor Diagnostic</span>
            </button>

            <button
              onClick={() => onNavigate('sessions')}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700 text-sm font-medium transition"
            >
              <Layers className="w-4 h-4 text-indigo-400" />
              <span>Manage Sessions ({sessions.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Sessions */}
        <div
          onClick={() => onNavigate('sessions')}
          className="glass-panel glass-panel-hover rounded-2xl p-5 border border-slate-800 cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Active Sessions</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-2xl font-extrabold text-white font-mono">{activeSessions.length}</span>
            <span className="text-xs text-slate-500">/ {sessions.length} total</span>
          </div>
          <div className="mt-2 text-xs text-emerald-400 flex items-center gap-1 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Ready for parallel execution</span>
          </div>
        </div>

        {/* Learned Sites */}
        <div
          onClick={() => onNavigate('sites')}
          className="glass-panel glass-panel-hover rounded-2xl p-5 border border-slate-800 cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Learned Sites</span>
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Globe className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-2xl font-extrabold text-white font-mono">{sites.length}</span>
            <span className="text-xs text-slate-500">stored in ~/.webcmd</span>
          </div>
          <div className="mt-2 text-xs text-cyan-400 flex items-center gap-1 font-medium">
            <span>Verified notes & sitemaps</span>
          </div>
        </div>

        {/* Reusable Workflows */}
        <div
          onClick={() => onNavigate('workflows')}
          className="glass-panel glass-panel-hover rounded-2xl p-5 border border-slate-800 cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Reusable Workflows</span>
            <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <GitBranch className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-2xl font-extrabold text-white font-mono">{workflows.length}</span>
            <span className="text-xs text-slate-500">1-click scripts</span>
          </div>
          <div className="mt-2 text-xs text-purple-400 flex items-center gap-1 font-medium">
            <span>Deterministic Playwright flows</span>
          </div>
        </div>

        {/* Daemon Health */}
        <div className="glass-panel rounded-2xl p-5 border border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Daemon Runtime</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Cpu className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline space-x-2">
            <span className="text-base font-bold text-white font-mono">
              {health?.daemon.connected ? 'Online :9777' : 'Standby'}
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-400 font-mono">
            {health?.daemon.runtimeName || 'CloakBrowser CDP'}
          </div>
        </div>
      </div>

      {/* Quick Launch Task Presets */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">One-Click Task Demonstrations</h3>
            <p className="text-xs text-slate-400">Select any pre-configured website task or create your own custom flow</p>
          </div>
          <button
            onClick={() => onNavigate('runner')}
            className="text-xs font-medium text-cyan-400 hover:text-cyan-300 flex items-center space-x-1"
          >
            <span>Open Custom Task Panel</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {demoPresets.map((preset, idx) => (
            <div
              key={idx}
              className="glass-panel glass-panel-hover rounded-2xl p-5 border border-slate-800 flex flex-col justify-between"
            >
              <div>
                <span className={`text-[10px] font-mono px-2.5 py-0.5 rounded-full border font-semibold ${preset.color}`}>
                  {preset.category}
                </span>
                <h4 className="text-sm font-bold text-white mt-3">{preset.title}</h4>
                <p className="text-xs text-slate-400 mt-1 font-mono">{preset.url}</p>
              </div>

              <div className="mt-5 pt-3 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">Autonomous Learn</span>
                <button
                  onClick={() => onLaunchTask(preset.url, preset.task)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs transition"
                >
                  <Play className="w-3 h-3 fill-current" />
                  <span>Run Task</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Grid: Active Sessions & Learned Sites Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Browser Sessions */}
        <div className="glass-panel rounded-2xl p-5 border border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Layers className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-white">Browser Sessions</h3>
            </div>
            <button
              onClick={() => onNavigate('sessions')}
              className="text-xs text-slate-400 hover:text-cyan-400 transition"
            >
              View all ({sessions.length})
            </button>
          </div>

          <div className="space-y-2">
            {sessions.slice(0, 5).map((s) => (
              <div
                key={s.id}
                className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 flex items-center justify-between text-xs"
              >
                <div>
                  <div className="font-mono font-semibold text-slate-200 flex items-center gap-2">
                    <span>{s.id}</span>
                    {s.runtimeState === 'active' && (
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Profile: {s.profileId} • {s.kind}
                  </p>
                </div>
                <div className="text-right">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                      s.runtimeState === 'active'
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {s.runtimeState}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recently Learned Sites */}
        <div className="glass-panel rounded-2xl p-5 border border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Globe className="w-4 h-4 text-purple-400" />
              <h3 className="text-sm font-bold text-white">Learned Sites Memory</h3>
            </div>
            <button
              onClick={() => onNavigate('sites')}
              className="text-xs text-slate-400 hover:text-purple-400 transition"
            >
              View all ({sites.length})
            </button>
          </div>

          <div className="space-y-2">
            {sites.slice(0, 5).map((site) => (
              <div
                key={site.key}
                className="p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 flex items-center justify-between text-xs"
              >
                <div>
                  <span className="font-semibold text-slate-200">{site.domain}</span>
                  <div className="flex items-center space-x-2 mt-1">
                    {site.hasNotes && (
                      <span className="text-[10px] text-cyan-400 bg-cyan-500/10 px-1.5 py-0.2 rounded border border-cyan-500/20">
                        notes.md
                      </span>
                    )}
                    {site.hasSitemap && (
                      <span className="text-[10px] text-purple-400 bg-purple-500/10 px-1.5 py-0.2 rounded border border-purple-500/20">
                        SITE.md
                      </span>
                    )}
                    {site.hasEndpoints && (
                      <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
                        endpoints
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => onNavigate('sites')}
                  className="p-1 rounded text-slate-400 hover:text-white"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
