import React, { useState, useEffect } from 'react';
import { ShieldCheck, GitCommit, Clock, FileCheck, Layers, RefreshCw } from 'lucide-react';
import { api } from '../api';
import type { CheckpointItem, SiteSummary } from '../types';

interface CheckpointsPageProps {
  sites: SiteSummary[];
}

export const CheckpointsPage: React.FC<CheckpointsPageProps> = ({ sites }) => {
  const [checkpoints, setCheckpoints] = useState<CheckpointItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadCheckpoints = async () => {
    setIsLoading(true);
    try {
      const res = await api.getCheckpoints();
      setCheckpoints(res.checkpoints || []);
    } catch {
      setCheckpoints([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCheckpoints();
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <span>Site Memory Checkpoints</span>
          </h2>
          <p className="text-xs text-slate-400">
            Durable git revisions, manifest revisions, and candidate ingestion commits for learned sites
          </p>
        </div>

        <button
          onClick={loadCheckpoints}
          className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 self-start"
          title="Refresh Checkpoints"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Checkpoints Timeline */}
      {isLoading ? (
        <div className="py-12 text-center text-slate-500 font-mono text-xs">
          Loading memory checkpoints...
        </div>
      ) : checkpoints.length === 0 ? (
        <div className="glass-panel rounded-3xl p-12 text-center border border-slate-800 space-y-3">
          <ShieldCheck className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-sm font-bold text-white">No Explicit Checkpoints Yet</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Checkpoints are committed when tasks ingest candidates or publish sitemap drafts into active memory.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {checkpoints.map((cp, idx) => (
            <div
              key={idx}
              className="glass-panel rounded-2xl p-5 border border-slate-800 flex items-center justify-between gap-4"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 flex-shrink-0">
                  <GitCommit className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="font-bold text-white font-mono text-xs truncate">
                    {cp.product} • <span className="text-cyan-400">{cp.revision}</span>
                  </div>
                  <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                    <span>Reason: {cp.reason}</span>
                    <span>•</span>
                    <span>Paths: {cp.paths.join(', ')}</span>
                  </div>
                </div>
              </div>

              <div className="text-right flex-shrink-0">
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20 block mb-1">
                  {cp.status}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {new Date(cp.timestamp).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
