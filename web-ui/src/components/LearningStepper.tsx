import React from 'react';
import { Compass, Eye, Brain, CheckCircle2, Bookmark, Repeat, Loader2 } from 'lucide-react';

export type LearningPhase = 'IDLE' | 'DISCOVER' | 'OBSERVE' | 'LEARN' | 'VALIDATE' | 'CHECKPOINT' | 'REUSE' | 'COMPLETED';

interface LearningStepperProps {
  currentPhase: LearningPhase;
  durationMs?: number;
}

const PHASES: Array<{
  id: LearningPhase;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'DISCOVER', label: 'DISCOVER', description: 'Domain & Session Setup', icon: Compass },
  { id: 'OBSERVE', label: 'OBSERVE', description: 'Live DOM & Snapshot Analysis', icon: Eye },
  { id: 'LEARN', label: 'LEARN', description: 'Locator Discovery & Strategy', icon: Brain },
  { id: 'VALIDATE', label: 'VALIDATE', description: 'Action Execution & Extraction', icon: CheckCircle2 },
  { id: 'CHECKPOINT', label: 'CHECKPOINT', description: 'Site Memory Persistence', icon: Bookmark },
  { id: 'REUSE', label: 'REUSE', description: 'Deterministic 1-Click Replay', icon: Repeat },
];

export const LearningStepper: React.FC<LearningStepperProps> = ({ currentPhase, durationMs }) => {
  const phaseOrder = ['IDLE', 'DISCOVER', 'OBSERVE', 'LEARN', 'VALIDATE', 'CHECKPOINT', 'REUSE', 'COMPLETED'];
  const currentIndex = phaseOrder.indexOf(currentPhase);

  return (
    <div className="glass-panel rounded-2xl p-5 border border-slate-800/80 bg-slate-900/40">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white tracking-wide flex items-center gap-2">
            <span>Agent Self-Learning Pipeline</span>
            {currentPhase !== 'IDLE' && currentPhase !== 'COMPLETED' && (
              <span className="flex items-center gap-1 text-[11px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded-full border border-cyan-500/30">
                <Loader2 className="w-3 h-3 animate-spin" /> In Progress
              </span>
            )}
            {currentPhase === 'COMPLETED' && (
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/30">
                ✓ Workflow Verified
              </span>
            )}
          </h3>
          <p className="text-xs text-slate-400">
            Real-time autonomous discovery, observation, locator learning, and memory commit
          </p>
        </div>

        {durationMs !== undefined && durationMs > 0 && (
          <div className="text-right">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-mono">Execution Time</span>
            <span className="text-sm font-mono font-bold text-cyan-300">{(durationMs / 1000).toFixed(2)}s</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {PHASES.map((phase, idx) => {
          const Icon = phase.icon;
          const stepIndex = idx + 1; // 1-based for DISCOVER
          const isDone = currentIndex > stepIndex;
          const isActive = currentIndex === stepIndex;
          const isPending = currentIndex < stepIndex;

          return (
            <div
              key={phase.id}
              className={`relative rounded-xl p-3 border transition-all duration-300 flex flex-col justify-between ${
                isActive
                  ? 'bg-gradient-to-b from-cyan-500/15 to-transparent border-cyan-400 shadow-[0_0_15px_rgba(0,240,255,0.15)] ring-1 ring-cyan-500/30'
                  : isDone
                  ? 'bg-emerald-500/5 border-emerald-500/30 text-emerald-300'
                  : 'bg-slate-900/40 border-slate-800 text-slate-500'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                    isActive
                      ? 'bg-cyan-500 text-black shadow-md shadow-cyan-500/30'
                      : isDone
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {isActive ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
                </div>

                <span
                  className={`text-[10px] font-mono font-bold ${
                    isActive ? 'text-cyan-400' : isDone ? 'text-emerald-400' : 'text-slate-600'
                  }`}
                >
                  0{idx + 1}
                </span>
              </div>

              <div>
                <div
                  className={`text-xs font-bold tracking-wider ${
                    isActive ? 'text-white font-extrabold' : isDone ? 'text-slate-200' : 'text-slate-500'
                  }`}
                >
                  {phase.label}
                </div>
                <div className="text-[10px] text-slate-400 truncate mt-0.5 font-normal leading-tight">
                  {phase.description}
                </div>
              </div>

              {isActive && (
                <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-cyan-400 to-indigo-500 rounded-b-xl" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
