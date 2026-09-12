import React, { useState, useRef, useEffect } from 'react';
import { Terminal, Play, Trash2, Copy, Check, Sparkles, HelpCircle } from 'lucide-react';
import { api } from '../api';
import type { CliCommandResult } from '../types';

export const DeveloperConsole: React.FC = () => {
  const [command, setCommand] = useState('webcmd doctor');
  const [history, setHistory] = useState<CliCommandResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const presets = [
    { label: 'Doctor Diagnostic', cmd: 'webcmd doctor' },
    { label: 'List Sessions (JSON)', cmd: 'webcmd session list --format json' },
    { label: 'Show Amazon Memory', cmd: 'webcmd site memory show amazon.com -f json' },
    { label: 'List Amazon Memory Files', cmd: 'webcmd site memory list amazon.com' },
    { label: 'Show HN Memory', cmd: 'webcmd site memory show news.ycombinator.com -f json' },
    { label: 'List All Adapters', cmd: 'webcmd list -f json' },
  ];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, isLoading]);

  const handleRun = async (cmdToRun = command) => {
    if (!cmdToRun.trim() || isLoading) return;
    setIsLoading(true);

    try {
      const res = await api.execCommand(cmdToRun);
      setHistory((prev) => [...prev, res]);
    } catch (err: any) {
      setHistory((prev) => [
        ...prev,
        {
          ok: false,
          command: cmdToRun,
          stdout: '',
          stderr: err.message || 'Execution error',
          exitCode: 1,
          durationMs: 0,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div className="space-y-6 animate-fade-in flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Terminal className="w-5 h-5 text-cyan-400" />
            <span>Developer CLI Console</span>
          </h2>
          <p className="text-xs text-slate-400">
            Directly execute real Webcmd CLI commands and inspect structured output
          </p>
        </div>

        <button
          onClick={() => setHistory([])}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition border border-slate-700"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Clear History</span>
        </button>
      </div>

      {/* Presets Row */}
      <div className="flex items-center space-x-2 overflow-x-auto py-1">
        <span className="text-[11px] font-mono text-slate-500 uppercase tracking-wider flex-shrink-0">
          Quick Commands:
        </span>
        {presets.map((p, idx) => (
          <button
            key={idx}
            onClick={() => {
              setCommand(p.cmd);
              handleRun(p.cmd);
            }}
            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-mono whitespace-nowrap transition"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Terminal Screen */}
      <div className="flex-1 glass-panel rounded-3xl p-5 border border-slate-800 overflow-y-auto font-mono text-xs space-y-4 bg-[#070a11]">
        {history.length === 0 && !isLoading && (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 text-center">
            <Terminal className="w-12 h-12 text-slate-700 mb-3" />
            <p className="font-semibold text-slate-400">Webcmd Terminal Ready</p>
            <p className="text-xs text-slate-600 mt-1 max-w-md">
              Type any Webcmd command below to query real local daemon state, inspect site memory, or run browser actions.
            </p>
          </div>
        )}

        {history.map((item, idx) => (
          <div key={idx} className="space-y-2 border border-slate-800 rounded-2xl p-4 bg-slate-900/50">
            <div className="flex items-center justify-between text-[11px] text-slate-400 border-b border-slate-800/80 pb-2">
              <div className="flex items-center space-x-2 text-cyan-300 font-bold">
                <span className="text-emerald-400">$</span>
                <span>{item.command}</span>
              </div>
              <div className="flex items-center space-x-3">
                <span className="text-slate-500 font-mono">{item.durationMs}ms</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    item.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                  }`}
                >
                  code: {item.exitCode}
                </span>
                <button
                  onClick={() => handleCopy(item.stdout || item.stderr, idx)}
                  className="text-slate-400 hover:text-white"
                  title="Copy output"
                >
                  {copiedIdx === idx ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {item.stdout && (
              <pre className="text-slate-200 whitespace-pre-wrap overflow-x-auto leading-relaxed text-[11px]">
                {item.stdout}
              </pre>
            )}

            {item.stderr && (
              <pre className="text-rose-300 whitespace-pre-wrap overflow-x-auto leading-relaxed text-[11px]">
                {item.stderr}
              </pre>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center space-x-2 text-cyan-400 py-2">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span>Executing process...</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleRun();
        }}
        className="glass-panel rounded-2xl p-2 border border-slate-800 flex items-center space-x-2"
      >
        <div className="flex-1 relative flex items-center">
          <span className="absolute left-4 text-cyan-400 font-mono font-bold text-sm">$</span>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Type command, e.g. webcmd doctor, webcmd session list, webcmd site memory show amazon.com..."
            className="w-full pl-9 pr-4 py-3 rounded-xl bg-slate-900/90 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-cyan-400"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading || !command.trim()}
          className="flex items-center space-x-2 px-6 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black font-bold text-xs transition disabled:opacity-50 shadow-md shadow-cyan-500/20"
        >
          <Play className="w-3.5 h-3.5 fill-current" />
          <span>Execute</span>
        </button>
      </form>
    </div>
  );
};
