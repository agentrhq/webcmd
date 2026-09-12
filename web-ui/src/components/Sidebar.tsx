import React from 'react';
import {
  LayoutDashboard,
  PlaySquare,
  Layers,
  Globe,
  GitBranch,
  Search,
  ShieldCheck,
  Terminal,
  ChevronLeft,
  ChevronRight,
  Zap,
} from 'lucide-react';

export type PageId =
  | 'dashboard'
  | 'runner'
  | 'sessions'
  | 'sites'
  | 'workflows'
  | 'candidates'
  | 'checkpoints'
  | 'terminal';

interface SidebarProps {
  currentPage: PageId;
  onSelectPage: (page: PageId) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  stats?: {
    activeSessions: number;
    learnedSitesCount: number;
    workflowsCount: number;
  };
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPage,
  onSelectPage,
  collapsed,
  onToggleCollapse,
  stats,
}) => {
  const navItems: Array<{
    id: PageId;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number | string;
    badgeColor?: string;
  }> = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    {
      id: 'runner',
      label: 'Task Runner',
      icon: PlaySquare,
      badge: 'Live',
      badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
    },
    {
      id: 'sessions',
      label: 'Browser Sessions',
      icon: Layers,
      badge: stats?.activeSessions ? `${stats.activeSessions} active` : undefined,
      badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    },
    {
      id: 'sites',
      label: 'Learned Sites',
      icon: Globe,
      badge: stats?.learnedSitesCount || undefined,
      badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    },
    {
      id: 'workflows',
      label: 'Workflows',
      icon: GitBranch,
      badge: stats?.workflowsCount || undefined,
      badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    },
    { id: 'candidates', label: 'Candidates', icon: Search },
    { id: 'checkpoints', label: 'Checkpoints', icon: ShieldCheck },
    { id: 'terminal', label: 'Developer Console', icon: Terminal },
  ];

  return (
    <aside
      className={`fixed top-0 left-0 bottom-0 z-40 flex flex-col bg-[#0b0f19] border-r border-slate-800/80 transition-all duration-300 ${
        collapsed ? 'w-20' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800/80 bg-slate-900/30">
        {!collapsed && (
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-extrabold text-base tracking-tight text-white flex items-center gap-1.5">
                WEBCMD <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono">v0.8.4</span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">AI Browser Engine</p>
            </div>
          </div>
        )}

        {collapsed && (
          <div className="w-full flex justify-center">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Zap className="w-5 h-5 text-white" />
            </div>
          </div>
        )}

        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectPage(item.id)}
              className={`w-full flex items-center rounded-xl transition-all duration-200 group relative ${
                collapsed ? 'justify-center p-3' : 'px-3.5 py-2.5 space-x-3'
              } ${
                isActive
                  ? 'bg-gradient-to-r from-cyan-500/15 to-indigo-500/10 text-cyan-400 font-medium border border-cyan-500/30 shadow-sm shadow-cyan-500/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
              }`}
              title={collapsed ? item.label : undefined}
            >
              <Icon
                className={`w-5 h-5 flex-shrink-0 transition-transform group-hover:scale-105 ${
                  isActive ? 'text-cyan-400' : 'text-slate-400 group-hover:text-slate-200'
                }`}
              />

              {!collapsed && (
                <div className="flex-1 flex items-center justify-between text-left">
                  <span className="text-sm tracking-wide">{item.label}</span>
                  {item.badge !== undefined && (
                    <span
                      className={`text-[10px] font-mono px-2 py-0.5 rounded-full border font-semibold ${
                        item.badgeColor || 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
              )}

              {isActive && (
                <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-1 h-6 bg-cyan-400 rounded-r-full shadow-[0_0_8px_#00f0ff]" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer / System Status */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-900/40">
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'space-x-2.5'} px-1 py-1.5`}>
          <div className="relative flex items-center justify-center">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <span className="absolute w-4 h-4 rounded-full bg-emerald-400/40 animate-ping-slow"></span>
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-300 truncate">Daemon Ready</p>
              <p className="text-[10px] text-slate-500 font-mono">Port 9777 • Local CDP</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
