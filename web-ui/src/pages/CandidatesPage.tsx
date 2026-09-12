import React, { useState, useEffect } from 'react';
import { Search, Plus, CheckCircle2, Clock, AlertTriangle, Shield, RefreshCw } from 'lucide-react';
import { api } from '../api';
import type { CandidateItem, SiteSummary } from '../types';

interface CandidatesPageProps {
  sites: SiteSummary[];
}

export const CandidatesPage: React.FC<CandidatesPageProps> = ({ sites }) => {
  const [candidates, setCandidates] = useState<CandidateItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newCandidate, setNewCandidate] = useState({
    product: sites[0]?.domain || 'amazon.com',
    kind: 'selector',
    claim: '',
    evidence: '',
    consequence: '',
  });

  const loadCandidates = async (product?: string) => {
    setIsLoading(true);
    try {
      const res = await api.getCandidates(product);
      setCandidates(res.candidates || []);
    } catch {
      setCandidates([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCandidates(selectedProduct || undefined);
  }, [selectedProduct]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCandidate.claim || !newCandidate.evidence) return;
    try {
      await api.addCandidate(newCandidate);
      setIsAdding(false);
      setNewCandidate({
        product: sites[0]?.domain || 'amazon.com',
        kind: 'selector',
        claim: '',
        evidence: '',
        consequence: '',
      });
      loadCandidates(selectedProduct || undefined);
    } catch (err: any) {
      alert(`Could not add candidate: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Search className="w-5 h-5 text-cyan-400" />
            <span>Learning Candidates Repository</span>
          </h2>
          <p className="text-xs text-slate-400">
            Durable candidate evidence, qualifying observations, and provenance tracking across sites
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <select
            value={selectedProduct}
            onChange={(e) => setSelectedProduct(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white font-mono"
          >
            <option value="">All Learned Sites</option>
            {sites.map((s) => (
              <option key={s.domain} value={s.domain}>
                {s.domain}
              </option>
            ))}
          </select>

          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center space-x-1 px-3.5 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs transition"
          >
            <Plus className="w-4 h-4" />
            <span>Add Candidate</span>
          </button>
        </div>
      </div>

      {/* Add Candidate Modal/Drawer */}
      {isAdding && (
        <form onSubmit={handleAdd} className="glass-panel rounded-3xl p-6 border border-cyan-500/30 bg-slate-900/90 space-y-4 animate-slide-up">
          <h3 className="text-sm font-bold text-white">Record Candidate Evidence Observation</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400">Target Product / Site</label>
              <input
                type="text"
                value={newCandidate.product}
                onChange={(e) => setNewCandidate({ ...newCandidate, product: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white font-mono mt-1"
                required
              />
            </div>
            <div>
              <label className="text-xs text-slate-400">Kind</label>
              <select
                value={newCandidate.kind}
                onChange={(e) => setNewCandidate({ ...newCandidate, kind: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white mt-1"
              >
                <option value="selector">selector</option>
                <option value="endpoint">endpoint</option>
                <option value="access">access</option>
                <option value="quirk">quirk</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-slate-400">Claim</label>
              <input
                type="text"
                value={newCandidate.claim}
                onChange={(e) => setNewCandidate({ ...newCandidate, claim: e.target.value })}
                placeholder="e.g. Search input selector is #twotabsearchtextbox"
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white mt-1"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-slate-400">Secret-Free Evidence</label>
              <textarea
                value={newCandidate.evidence}
                onChange={(e) => setNewCandidate({ ...newCandidate, evidence: e.target.value })}
                placeholder="e.g. Observed live search query submitting via #nav-search-submit-button"
                rows={2}
                className="w-full p-3 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white mt-1 font-mono"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-xs text-slate-400">Consequence</label>
              <input
                type="text"
                value={newCandidate.consequence}
                onChange={(e) => setNewCandidate({ ...newCandidate, consequence: e.target.value })}
                placeholder="e.g. Reusable for automated search workflows"
                className="w-full px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-white mt-1"
              />
            </div>
          </div>
          <div className="flex justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-4 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-1.5 rounded-lg bg-cyan-500 text-black font-bold text-xs"
            >
              Save Candidate
            </button>
          </div>
        </form>
      )}

      {/* Candidates List */}
      {isLoading ? (
        <div className="py-12 text-center text-slate-500 font-mono text-xs">
          Loading learning candidates...
        </div>
      ) : candidates.length === 0 ? (
        <div className="glass-panel rounded-3xl p-12 text-center border border-slate-800 space-y-2">
          <Search className="w-10 h-10 text-slate-600 mx-auto" />
          <h3 className="text-sm font-bold text-white">No Learning Candidates Found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Candidates are captured during task runs when new locators or endpoints qualify for observation.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {candidates.map((c, idx) => (
            <div
              key={c.id || idx}
              className="glass-panel rounded-2xl p-5 border border-slate-800 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  {c.kind} • {c.product || c.domain}
                </span>

                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                    c.status === 'ingested'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  }`}
                >
                  {c.status || 'pending'}
                </span>
              </div>

              <div>
                <h4 className="text-xs font-bold text-white">{c.claim}</h4>
                <p className="text-[11px] text-slate-400 font-mono mt-1 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800">
                  {c.evidence}
                </p>
              </div>

              {c.consequence && (
                <div className="text-[11px] text-slate-500">
                  <span className="font-semibold text-slate-400">Consequence:</span> {c.consequence}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
