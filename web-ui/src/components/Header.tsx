import React from 'react';
import { Terminal, RefreshCw, Layers, Shield, Cpu } from 'lucide-react';
import type { DaemonInfo } from '../types';

interface HeaderProps {
  title: string;
  subtitle?: string;
  daemon?: DaemonInfo;
  activeSessionId?: string;
  onOpenTerminal: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  subtitle,
  daemon,
  activeSessionId,
  onOpenTerminal,
  onRefresh,
  isRefreshing,
}) => {
  return (
    <header className="h-16 border-b border-slate-800/80 bg-[#090d16]/80 backdrop-blur-md sticky top-0 z-30 px-6 flex items-center justify-between">
      {/* Title */}
      <div>
        <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
          {title}
        </h1>
        {subtitle && <p className="text-xs text-slate-400 font-normal">{subtitle}</p>}
      </div>

      {/* Right Action & Status Area */}
      <div className="flex items-center space-x-3">
        {/* Active Session Badge */}
        {activeSessionId && (
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs font-mono">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span>{activeSessionId}</span>
          </div>
        )}

        {/* Daemon Status Pill */}
        <div
          className={`flex items-center space-x-2 px-3 py-1 rounded-full text-xs font-medium border ${
            daemon?.connected
              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
              : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              daemon?.connected ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-amber-400'
            }`}
          />
          <span>{daemon?.connected ? 'Daemon Online' : 'Daemon Standby'}</span>
        </div>

        {/* Developer Console Button */}
        <button
          onClick={onOpenTerminal}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700 hover:border-slate-600 text-xs font-medium transition shadow-sm hover:shadow"
          title="Open Developer Console (CLI)"
        >
          <Terminal className="w-3.5 h-3.5 text-cyan-400" />
          <span>Console</span>
        </button>

        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          className={`p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 border border-slate-700 hover:border-slate-600 transition ${
            isRefreshing ? 'animate-spin text-cyan-400' : ''
          }`}
          title="Refresh Data"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
