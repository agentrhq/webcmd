import React, { useState, useEffect } from 'react';
import { Sidebar, type PageId } from './components/Sidebar';
import { Header } from './components/Header';
import { TerminalModal } from './components/TerminalModal';
import { Dashboard } from './pages/Dashboard';
import { TaskRunner } from './pages/TaskRunner';
import { SessionsPage } from './pages/SessionsPage';
import { LearnedSitesPage } from './pages/LearnedSitesPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { CandidatesPage } from './pages/CandidatesPage';
import { CheckpointsPage } from './pages/CheckpointsPage';
import { DeveloperConsole } from './pages/DeveloperConsole';
import { api } from './api';
import type { HealthResponse, BrowserSession, SiteSummary, StoredWorkflow } from './types';

export const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<PageId>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [terminalDefaultCmd, setTerminalDefaultCmd] = useState('webcmd doctor');

  // App Data
  const [health, setHealth] = useState<HealthResponse | undefined>();
  const [sessions, setSessions] = useState<BrowserSession[]>([]);
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [workflows, setWorkflows] = useState<StoredWorkflow[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Selected preset task for TaskRunner
  const [presetUrl, setPresetUrl] = useState('https://www.amazon.in');
  const [presetTask, setPresetTask] = useState('Find Samsung Galaxy phone on Amazon');

  const refreshData = async () => {
    setIsRefreshing(true);
    try {
      const [healthRes, sessionsRes, sitesRes, workflowsRes] = await Promise.all([
        api.getHealth().catch(() => undefined),
        api.getSessions().catch(() => ({ ok: false, sessions: [] })),
        api.getSites().catch(() => ({ ok: false, sites: [] })),
        api.getWorkflows().catch(() => ({ ok: false, workflows: [] })),
      ]);

      if (healthRes) setHealth(healthRes);
      setSessions(sessionsRes.sessions || []);
      setSites(sitesRes.sites || []);
      setWorkflows(workflowsRes.workflows || []);
    } catch {
      // ignore
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    refreshData();
    const interval = setInterval(refreshData, 10000); // 10s auto sync
    return () => clearInterval(interval);
  }, []);

  const handleLaunchTask = (url: string, task: string) => {
    setPresetUrl(url);
    setPresetTask(task);
    setCurrentPage('runner');
  };

  const handleOpenTerminalWithCmd = (cmd = 'webcmd doctor') => {
    setTerminalDefaultCmd(cmd);
    setIsTerminalOpen(true);
  };

  const activeSession = sessions.find((s) => s.runtimeState === 'active')?.id;

  const pageTitles: Record<PageId, { title: string; subtitle: string }> = {
    dashboard: {
      title: 'Webcmd Agent Dashboard',
      subtitle: 'System health, active browser sessions, and quick automation flows',
    },
    runner: {
      title: 'Universal Task Runner',
      subtitle: 'Execute real tasks, discover locators, verify results, and commit site memory',
    },
    sessions: {
      title: 'Browser Sessions',
      subtitle: 'Manage local and CDP-bound browser sessions',
    },
    sites: {
      title: 'Learned Sites Memory',
      subtitle: 'Inspect and enrich persistent memory files across discovered sites',
    },
    workflows: {
      title: 'Reusable Workflows',
      subtitle: '1-click deterministic Playwright automation workflows',
    },
    candidates: {
      title: 'Candidate Evidence Repository',
      subtitle: 'Observations, claims, and provenance records for self-learning',
    },
    checkpoints: {
      title: 'Memory Checkpoints',
      subtitle: 'Committed memory revisions, drafts, and candidate ingestion commits',
    },
    terminal: {
      title: 'Developer Console',
      subtitle: 'Live interactive terminal against local Webcmd binary',
    },
  };

  return (
    <div className="min-h-screen bg-[#07090e] text-slate-100 flex">
      {/* Sidebar */}
      <Sidebar
        currentPage={currentPage}
        onSelectPage={setCurrentPage}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        stats={{
          activeSessions: sessions.filter((s) => s.runtimeState === 'active').length,
          learnedSitesCount: sites.length,
          workflowsCount: workflows.length,
        }}
      />

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
          sidebarCollapsed ? 'ml-20' : 'ml-64'
        }`}
      >
        <Header
          title={pageTitles[currentPage].title}
          subtitle={pageTitles[currentPage].subtitle}
          daemon={health?.daemon}
          activeSessionId={activeSession}
          onOpenTerminal={() => handleOpenTerminalWithCmd('webcmd doctor')}
          onRefresh={refreshData}
          isRefreshing={isRefreshing}
        />

        <main className="flex-1 p-6 md:p-8 max-w-7xl w-full mx-auto">
          {currentPage === 'dashboard' && (
            <Dashboard
              health={health}
              sessions={sessions}
              sites={sites}
              workflows={workflows}
              onNavigate={(page) => setCurrentPage(page as PageId)}
              onLaunchTask={handleLaunchTask}
              onOpenTerminal={handleOpenTerminalWithCmd}
            />
          )}

          {currentPage === 'runner' && (
            <TaskRunner
              sessions={sessions}
              initialUrl={presetUrl}
              initialTask={presetTask}
              onRefreshSessions={refreshData}
            />
          )}

          {currentPage === 'sessions' && (
            <SessionsPage
              sessions={sessions}
              onRefresh={refreshData}
              onSelectSession={(id) => {
                // Preselect session and go to runner
                setCurrentPage('runner');
              }}
            />
          )}

          {currentPage === 'sites' && (
            <LearnedSitesPage
              sites={sites}
              onRefresh={refreshData}
              onLaunchTaskOnSite={(siteUrl) => handleLaunchTask(siteUrl, `Explore ${siteUrl}`)}
            />
          )}

          {currentPage === 'workflows' && (
            <WorkflowsPage
              workflows={workflows}
              onRefresh={refreshData}
              onLaunchTask={handleLaunchTask}
            />
          )}

          {currentPage === 'candidates' && <CandidatesPage sites={sites} />}

          {currentPage === 'checkpoints' && <CheckpointsPage sites={sites} />}

          {currentPage === 'terminal' && <DeveloperConsole />}
        </main>
      </div>

      {/* Global Terminal Slide-Over Modal */}
      <TerminalModal
        isOpen={isTerminalOpen}
        onClose={() => setIsTerminalOpen(false)}
        defaultCommand={terminalDefaultCmd}
      />
    </div>
  );
};
