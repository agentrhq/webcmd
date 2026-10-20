import React, { useState } from 'react';
import { Globe, FileText, Map, Database, Search, Plus, ExternalLink, RefreshCw } from 'lucide-react';
import { api } from '../api';
import type { SiteSummary, SiteMemoryFile } from '../types';

interface LearnedSitesPageProps {
  sites: SiteSummary[];
  onRefresh: () => void;
  onLaunchTaskOnSite?: (site: string) => void;
}

export const LearnedSitesPage: React.FC<LearnedSitesPageProps> = ({
  sites,
  onRefresh,
  onLaunchTaskOnSite,
}) => {
  const [selectedSite, setSelectedSite] = useState<string>(sites[0]?.domain || 'amazon.com');
  const [memoryFiles, setMemoryFiles] = useState<SiteMemoryFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('notes.md');
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newNoteText, setNewNoteText] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);

  const loadMemory = async (siteKey: string) => {
    setSelectedSite(siteKey);
    setIsLoading(true);
    try {
      const res = await api.getSiteMemory(siteKey);
      setMemoryFiles(res.memory || []);
      if (res.memory && res.memory.length > 0) {
        setSelectedFile(res.memory[0].path);
      } else {
        setSelectedFile('');
      }
    } catch (err) {
      setMemoryFiles([]);
    } finally {
      setIsLoading(false);
    }
  };

  React.useEffect(() => {
    if (selectedSite) {
      loadMemory(selectedSite);
    }
  }, [selectedSite]);

  const handleAddNote = async () => {
    if (!newNoteText.trim() || !selectedSite) return;
    try {
      await api.addSiteNote(selectedSite, newNoteText.trim(), 'webcmd-agent');
      setNewNoteText('');
      setIsAddingNote(false);
      loadMemory(selectedSite);
    } catch (err: any) {
      alert(`Could not add note: ${err.message}`);
    }
  };

  const filteredSites = sites.filter((s) =>
    s.domain.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const currentFileContent = memoryFiles.find((f) => f.path === selectedFile)?.body || '';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Globe className="w-5 h-5 text-purple-400" />
            <span>Learned Sites Memory</span>
          </h2>
          <p className="text-xs text-slate-400">
            Durable per-site memory, notes, sitemaps, verified endpoints & fixtures stored in ~/.webcmd/sites
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter sites..."
              className="pl-8 pr-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-purple-400 font-mono"
            />
          </div>
          <button
            onClick={onRefresh}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
            title="Refresh Sites"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Grid: Sites Sidebar & Memory File Viewer */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        {/* Sites List Panel */}
        <div className="md:col-span-4 glass-panel rounded-3xl p-4 border border-slate-800 space-y-2 max-h-[75vh] overflow-y-auto">
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-2 py-1">
            Sites Inventory ({filteredSites.length})
          </div>

          {filteredSites.map((site) => {
            const isSelected = selectedSite === site.domain;
            return (
              <button
                key={site.domain}
                onClick={() => loadMemory(site.domain)}
                className={`w-full text-left p-3 rounded-2xl transition flex items-center justify-between group ${
                  isSelected
                    ? 'bg-gradient-to-r from-purple-500/20 to-indigo-500/10 border border-purple-500/40 text-purple-300'
                    : 'bg-slate-900/40 border border-slate-800/80 hover:bg-slate-800/40 text-slate-300'
                }`}
              >
                <div className="min-w-0 pr-2">
                  <div className="text-xs font-bold font-mono truncate">{site.domain}</div>
                  <div className="flex items-center space-x-1.5 mt-1">
                    {site.hasNotes && (
                      <span className="text-[9px] text-cyan-400 bg-cyan-500/10 px-1.5 py-0.2 rounded border border-cyan-500/20">
                        notes
                      </span>
                    )}
                    {site.hasSitemap && (
                      <span className="text-[9px] text-purple-400 bg-purple-500/10 px-1.5 py-0.2 rounded border border-purple-500/20">
                        sitemap
                      </span>
                    )}
                    {site.hasEndpoints && (
                      <span className="text-[9px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/20">
                        api
                      </span>
                    )}
                  </div>
                </div>

                {onLaunchTaskOnSite && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      onLaunchTaskOnSite(`https://${site.domain}`);
                    }}
                    className="p-1 rounded text-slate-500 hover:text-cyan-400"
                    title="Launch task on site"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Memory Content Viewer */}
        <div className="md:col-span-8 glass-panel rounded-3xl p-6 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
                <span>{selectedSite}</span>
                <span className="text-xs font-normal text-slate-400 font-sans">• Site Memory Records</span>
              </h3>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => setIsAddingNote(!isAddingNote)}
                className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Append Note</span>
              </button>
            </div>
          </div>

          {/* Add Note Input Area */}
          {isAddingNote && (
            <div className="p-4 rounded-2xl bg-slate-900 border border-purple-500/30 space-y-2 animate-slide-up">
              <label className="text-xs font-semibold text-slate-300">Append Markdown Note to {selectedSite}</label>
              <textarea
                value={newNoteText}
                onChange={(e) => setNewNoteText(e.target.value)}
                placeholder="e.g. [Verified] Search box uses #twotabsearchtextbox; requires session cookie for cart..."
                rows={3}
                className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white font-mono focus:outline-none focus:border-purple-400"
              />
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setIsAddingNote(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddNote}
                  className="px-4 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold"
                >
                  Save Note
                </button>
              </div>
            </div>
          )}

          {/* File Tabs */}
          {memoryFiles.length > 0 && (
            <div className="flex items-center space-x-1 border-b border-slate-800/80 pb-2 overflow-x-auto">
              {memoryFiles.map((file) => {
                const isSelected = selectedFile === file.path;
                return (
                  <button
                    key={file.path}
                    onClick={() => setSelectedFile(file.path)}
                    className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition ${
                      isSelected
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 font-semibold'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent'
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>{file.path}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Document Content */}
          {isLoading ? (
            <div className="py-12 text-center text-slate-500 text-xs font-mono">
              Loading memory files for {selectedSite}...
            </div>
          ) : memoryFiles.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              No memory files found for {selectedSite}. Run a task to generate initial memory!
            </div>
          ) : (
            <pre className="p-4 rounded-2xl bg-[#080b12] border border-slate-800 font-mono text-xs text-slate-200 whitespace-pre-wrap leading-relaxed max-h-[55vh] overflow-y-auto">
              {currentFileContent}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
