import React, { useState } from 'react';
import { GitBranch, Play, RotateCw, CheckCircle2, Clock, Code2, Copy, Check, Plus, ExternalLink } from 'lucide-react';
import { api } from '../api';
import type { StoredWorkflow } from '../types';

interface WorkflowsPageProps {
  workflows: StoredWorkflow[];
  onRefresh: () => void;
  onLaunchTask?: (url: string, task: string) => void;
}

export const WorkflowsPage: React.FC<WorkflowsPageProps> = ({
  workflows,
  onRefresh,
  onLaunchTask,
}) => {
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(workflows[0]?.id || null);

  const handleReplay = async (wf: StoredWorkflow) => {
    setReplayingId(wf.id);
    try {
      const res = await api.replayTask({ workflowId: wf.id });
      alert(`Workflow "${wf.name}" replayed in ${(res.durationMs / 1000).toFixed(2)}s!`);
      onRefresh();
    } catch (err: any) {
      alert(`Replay failed: ${err.message}`);
    } finally {
      setReplayingId(null);
    }
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-amber-400" />
            <span>Learned Workflows Catalog</span>
          </h2>
          <p className="text-xs text-slate-400">
            Reusable, deterministic Playwright automation workflows learned from live websites
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono text-slate-400 bg-slate-900 px-3 py-1.5 rounded-xl border border-slate-800">
            {workflows.length} Verified Workflows
          </span>
        </div>
      </div>

      {/* Workflows List */}
      <div className="space-y-4">
        {workflows.map((wf) => {
          const isExpanded = expandedId === wf.id;
          const isReplaying = replayingId === wf.id;

          return (
            <div
              key={wf.id}
              className="glass-panel rounded-3xl p-6 border border-slate-800 hover:border-slate-700/80 transition space-y-4"
            >
              {/* Header Info Row */}
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2.5">
                    <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 text-[10px] font-mono font-bold uppercase">
                      {wf.site}
                    </span>
                    <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> {wf.status}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-white mt-1">{wf.name}</h3>
                  <p className="text-xs text-slate-400 font-mono">{wf.task}</p>
                </div>

                <div className="flex items-center space-x-2 flex-shrink-0">
                  <button
                    onClick={() => handleReplay(wf)}
                    disabled={isReplaying}
                    className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition disabled:opacity-50 shadow-md shadow-purple-600/20"
                  >
                    <RotateCw className={`w-3.5 h-3.5 ${isReplaying ? 'animate-spin' : ''}`} />
                    <span>{isReplaying ? 'Replaying...' : 'Replay'}</span>
                  </button>

                  {onLaunchTask && (
                    <button
                      onClick={() => onLaunchTask(wf.url, wf.task)}
                      className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700"
                    >
                      <Play className="w-3 h-3 text-cyan-400 fill-current" />
                      <span>Run in Runner</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Execution Stats & Steps */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-2">
                {/* Steps List */}
                <div className="md:col-span-7 space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Workflow Steps</span>
                  <div className="space-y-1">
                    {wf.steps.map((step, idx) => (
                      <div key={idx} className="flex items-start space-x-2 text-xs text-slate-300">
                        <span className="text-cyan-400 font-mono text-[11px] font-bold">0{idx + 1}.</span>
                        <span>{step}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Discovered Locators */}
                <div className="md:col-span-5 space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Discovered Locators</span>
                  <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1 text-xs font-mono">
                    {Object.entries(wf.locators).map(([k, v]) => (
                      <div key={k} className="flex justify-between items-center text-[11px]">
                        <span className="text-slate-500">{k}:</span>
                        <span className="text-cyan-300 truncate max-w-[180px]" title={v}>
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Collapsible Script Preview */}
              <div className="pt-2 border-t border-slate-800/80">
                <div className="flex items-center justify-between">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : wf.id)}
                    className="text-xs text-slate-400 hover:text-white flex items-center space-x-1"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    <span>{isExpanded ? 'Hide Automation Code' : 'View Automation Code'}</span>
                  </button>

                  <div className="flex items-center space-x-3 text-xs text-slate-500 font-mono">
                    <span>Duration: {(wf.lastDurationMs / 1000).toFixed(2)}s</span>
                    <span>Last run: {new Date(wf.lastRunAt).toLocaleDateString()}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 relative">
                    <pre className="p-4 rounded-2xl bg-[#080b12] border border-slate-800 font-mono text-xs text-cyan-300 whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-48">
                      {wf.script}
                    </pre>
                    <button
                      onClick={() => handleCopy(wf.script, wf.id)}
                      className="absolute top-3 right-3 p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white"
                      title="Copy script"
                    >
                      {copiedId === wf.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
