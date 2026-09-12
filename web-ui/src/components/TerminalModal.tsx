import React, { useState, useRef, useEffect } from 'react';
import { Terminal as TerminalIcon, X, Play, Copy, Check, Trash2, CornerDownLeft } from 'lucide-react';
import { api } from '../api';
import type { CliCommandResult } from '../types';

interface TerminalModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultCommand?: string;
}

export const TerminalModal: React.FC<TerminalModalProps> = ({ isOpen, onClose, defaultCommand }) => {
  const [command, setCommand] = useState(defaultCommand || 'webcmd doctor');
  const [history, setHistory] = useState<CliCommandResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const presets = [
    'webcmd doctor',
    'webcmd session list --format json',
    'webcmd site memory list amazon.com',
    'webcmd site memory show amazon.com -f json',
    'webcmd site memory list news.ycombinator.com',
    'webcmd list -f json',
  ];

  useEffect(() => {
    if (defaultCommand) setCommand(defaultCommand);
  }, [defaultCommand]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, isLoading]);

  if (!isOpen) return null;

  const handleRun = async (cmdToRun = command) => {
    if (!cmdToRun.trim() || isLoading) return;
    setIsLoading(true);

    try {
      const result = await api.execCommand(cmdToRun);
      setHistory((prev) => [...prev, result]);
    } catch (err: any) {
      setHistory((prev) => [
        ...prev,
        {
          ok: false,
          command: cmdToRun,
          stdout: '',
          stderr: err.message || 'Execution failed',
          exitCode: 1,
          durationMs: 0,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-4xl h-[80vh] flex flex-col bg-[#0b0f19] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="h-14 px-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <TerminalIcon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide">Developer Console (CLI Engine)</h2>
              <p className="text-[11px] text-slate-400 font-mono">Direct CLI execution against local Webcmd</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setHistory([])}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
              title="Clear terminal history"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Quick Presets Bar */}
        <div className="px-5 py-2.5 bg-slate-900/30 border-b border-slate-800/80 flex items-center space-x-2 overflow-x-auto text-xs">
          <span className="text-[11px] font-mono text-slate-500 uppercase tracking-wider flex-shrink-0">Presets:</span>
          {presets.map((p) => (
            <button
              key={p}
              onClick={() => {
                setCommand(p);
                handleRun(p);
              }}
              className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[11px] whitespace-nowrap transition border border-slate-700/80 hover:border-slate-600"
            >
              {p}
            </button>
          ))}
        </div>

        {/* Terminal Output Area */}
        <div className="flex-1 p-5 overflow-y-auto font-mono text-xs space-y-4 bg-[#070a11]">
          {history.length === 0 && !isLoading && (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center">
              <TerminalIcon className="w-12 h-12 text-slate-700 mb-3" />
              <p className="font-semibold text-slate-400">Webcmd Terminal Ready</p>
              <p className="text-xs text-slate-600 mt-1 max-w-sm">
                Type any Webcmd command below or select a preset to query sessions, inspect site memory, or run browser actions.
              </p>
            </div>
          )}

          {history.map((item, idx) => (
            <div key={idx} className="space-y-1.5 border border-slate-800/60 rounded-xl p-3.5 bg-slate-900/40">
              <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800/60 pb-2">
                <div className="flex items-center space-x-2 font-bold text-cyan-300">
                  <span className="text-emerald-400">$</span>
                  <span>{item.command}</span>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="text-slate-500">{item.durationMs}ms</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      item.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                    }`}
                  >
                    code: {item.exitCode}
                  </span>
                  <button
                    onClick={() => handleCopy(item.stdout || item.stderr, idx)}
                    className="text-slate-400 hover:text-white transition"
                    title="Copy output"
                  >
                    {copiedIndex === idx ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {item.stdout && (
                <pre className="text-slate-200 whitespace-pre-wrap overflow-x-auto pt-1 leading-relaxed text-[11px]">
                  {item.stdout}
                </pre>
              )}

              {item.stderr && (
                <pre className="text-rose-300 whitespace-pre-wrap overflow-x-auto pt-1 leading-relaxed text-[11px]">
                  {item.stderr}
                </pre>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center space-x-2 text-cyan-400 py-2">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
              <span>Executing webcmd process...</span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRun();
          }}
          className="p-4 border-t border-slate-800 bg-slate-900/60 flex items-center space-x-3"
        >
          <div className="flex-1 relative flex items-center">
            <span className="absolute left-3.5 text-cyan-400 font-mono font-bold text-sm">$</span>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="e.g. webcmd doctor, webcmd session list, webcmd site memory show amazon.com"
              className="w-full pl-8 pr-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700/80 text-white font-mono text-xs focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 transition"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || !command.trim()}
            className="flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-semibold text-xs transition disabled:opacity-50 shadow-md shadow-cyan-500/20"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Execute</span>
          </button>
        </form>
      </div>
    </div>
  );
};
