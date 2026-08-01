'use client';

import { useEffect, useRef, useState } from 'react';
import {
  FileText, Play, Loader2, CheckCircle, XCircle, RotateCcw, ChevronRight,
} from 'lucide-react';

// ── types ─────────────────────────────────────────────────────────────────────

type Mode = 'idle' | 'running' | 'done';

interface LogEntry {
  id: string;
  stage: string;
  message: string;
  ts: number;
}

export interface RunResult {
  status: string;
  proposal_id?: string;
  table_name?: string;
  ddl?: string;
  revisions?: number;
  regression_passed?: boolean;
  trace_url?: string;
  reason?: string;
  error?: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const STAGE_META: Record<string, { color: string; label: string }> = {
  init:     { color: '#2563eb', label: 'init' },
  trace:    { color: '#7c3aed', label: 'trace' },
  tool:     { color: '#d97706', label: 'tool' },
  complete: { color: '#16a34a', label: 'done' },
  error:    { color: '#dc2626', label: 'error' },
  warning:  { color: '#d97706', label: 'warn' },
};

function stageMeta(stage: string) {
  return STAGE_META[stage] ?? { color: '#9c9088', label: stage };
}

function elapsed(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 2) return 'now';
  if (s < 60) return `${Math.floor(s)}s`;
  return `${Math.floor(s / 60)}m`;
}

// ── sub-components ────────────────────────────────────────────────────────────

function LogRow({ entry }: { entry: LogEntry }) {
  const { color, label } = stageMeta(entry.stage);
  const [expanded, setExpanded] = useState(false);
  const isLong = entry.message.length > 90;
  return (
    <div
      className="flex items-start gap-2.5 py-1.5 border-b last:border-0"
      style={{ borderColor: '#f0ece6', cursor: isLong ? 'pointer' : 'default' }}
      onClick={() => isLong && setExpanded((v) => !v)}
    >
      <span className="mt-[3px] h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>
            {label}
          </span>
          <p
            className="flex-1 text-xs"
            style={{
              color: '#4a4540',
              whiteSpace: expanded ? 'pre-wrap' : 'nowrap',
              overflow: expanded ? 'visible' : 'hidden',
              textOverflow: expanded ? 'clip' : 'ellipsis',
              wordBreak: expanded ? 'break-word' : 'normal',
              fontFamily: expanded ? 'ui-monospace, monospace' : 'inherit',
            }}
          >
            {entry.message}
          </p>
          <span className="flex-shrink-0 text-[10px]" style={{ color: '#c0b8b0' }}>{elapsed(entry.ts)}</span>
        </div>
        {isLong && (
          <p className="mt-0.5 text-[9.5px]" style={{ color: '#c0b8b0' }}>
            {expanded ? 'click to collapse' : `click to expand (${entry.message.length} chars)`}
          </p>
        )}
      </div>
    </div>
  );
}

// ── main panel ────────────────────────────────────────────────────────────────

export function AgentPanel() {
  const [mode, setMode] = useState<Mode>('idle');
  const [specName, setSpecName] = useState('');
  const [specFile, setSpecFile] = useState<File | null>(null);
  const [eventsFile, setEventsFile] = useState<File | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // resizable
  const [panelWidth, setPanelWidth] = useState(380);
  const dragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  const onDragStart = (e: React.MouseEvent) => {
    dragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = panelWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = dragStartX.current - e.clientX;
      setPanelWidth(Math.min(640, Math.max(280, dragStartW.current + delta)));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  // auto-scroll logs
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const addLog = (stage: string, message: string) =>
    setLogs((prev) => [...prev, { id: crypto.randomUUID(), stage, message, ts: Date.now() }]);

  const handleRun = async () => {
    if (!specName.trim() || !specFile || !eventsFile) return;
    setMode('running');
    setLogs([]);
    setResult(null);

    const specMarkdown = await specFile.text();
    const formData = new FormData();
    formData.append('specName', specName);
    formData.append('specMarkdown', specMarkdown);
    formData.append('eventsFile', eventsFile);

    try {
      const res = await fetch('/api/ingest', { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of dec.decode(value).split('\n\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'log') {
              addLog(data.stage ?? 'info', data.message);
            } else if (data.type === 'complete') {
              setResult(data.result);
              setMode('done');
              window.dispatchEvent(new CustomEvent('spec-result', { detail: data.result }));
            } else if (data.type === 'error') {
              addLog('error', data.message);
              setResult({ status: 'failed', error: data.message });
              setMode('done');
            }
          } catch { /* bad json line */ }
        }
      }
    } catch (err) {
      addLog('error', String(err));
      setResult({ status: 'failed', error: String(err) });
      setMode('done');
    }
  };

  const reset = () => {
    setMode('idle');
    setLogs([]);
    setResult(null);
    setSpecName('');
    setSpecFile(null);
    setEventsFile(null);
  };

  const canRun = specName.trim() && specFile && eventsFile;

  return (
    <div
      className="relative flex h-screen flex-shrink-0 flex-col border-l"
      style={{ width: panelWidth, backgroundColor: '#ffffff', borderColor: '#e5dfd6' }}
    >
      {/* Drag handle */}
      <div
        onMouseDown={onDragStart}
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-blue-400/30"
      />

      {/* Header */}
      <div className="flex h-14 flex-shrink-0 items-center justify-between border-b px-4" style={{ borderColor: '#e5dfd6' }}>
        <div className="flex items-center gap-2">
          {mode === 'running' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
          {mode === 'done' && result?.status === 'executed' && <CheckCircle className="h-4 w-4 text-green-600" />}
          {mode === 'done' && result?.status !== 'executed' && <XCircle className="h-4 w-4 text-red-500" />}
          {mode === 'idle' && <Play className="h-4 w-4" style={{ color: '#9c9088' }} />}
          <span className="text-sm font-semibold" style={{ color: '#1c1814' }}>
            {mode === 'idle' ? 'Run Spec' : mode === 'running' ? 'Running…' : 'Complete'}
          </span>
        </div>
        {mode === 'done' && (
          <button onClick={reset} className="flex items-center gap-1 text-xs transition-opacity hover:opacity-70" style={{ color: '#7a7068' }}>
            <RotateCcw className="h-3 w-3" /> Run another
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">

        {/* ── IDLE: form ── */}
        {mode === 'idle' && (
          <div className="space-y-5 p-4">

            {/* Spec name */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#9c9088' }}>
                Spec Name
              </label>
              <input
                type="text"
                value={specName}
                onChange={(e) => setSpecName(e.target.value)}
                placeholder="e.g. express_checkout"
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors focus:border-blue-400"
                style={{ borderColor: '#e5dfd6', backgroundColor: '#faf8f5', color: '#1c1814' }}
              />
            </div>

            {/* Spec file */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#9c9088' }}>
                Spec Markdown
              </label>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors hover:border-blue-300"
                style={{ borderColor: specFile ? '#2563eb' : '#e5dfd6', backgroundColor: specFile ? '#eff6ff' : '#faf8f5' }}>
                <FileText className="h-4 w-4 flex-shrink-0" style={{ color: specFile ? '#2563eb' : '#9c9088' }} />
                <span className="flex-1 truncate text-xs" style={{ color: specFile ? '#1c1814' : '#9c9088' }}>
                  {specFile ? specFile.name : 'Choose spec.md…'}
                </span>
                {specFile && <ChevronRight className="h-3 w-3 text-blue-400" />}
                <input type="file" accept=".md,.markdown" className="hidden"
                  onChange={(e) => setSpecFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>

            {/* NDJSON file */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: '#9c9088' }}>
                Sample Events (NDJSON)
              </label>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors hover:border-blue-300"
                style={{ borderColor: eventsFile ? '#2563eb' : '#e5dfd6', backgroundColor: eventsFile ? '#eff6ff' : '#faf8f5' }}>
                <FileText className="h-4 w-4 flex-shrink-0" style={{ color: eventsFile ? '#2563eb' : '#9c9088' }} />
                <span className="flex-1 truncate text-xs" style={{ color: eventsFile ? '#1c1814' : '#9c9088' }}>
                  {eventsFile ? eventsFile.name : 'Choose events.ndjson…'}
                </span>
                {eventsFile && <ChevronRight className="h-3 w-3 text-blue-400" />}
                <input type="file" accept=".ndjson,.jsonl,.json" className="hidden"
                  onChange={(e) => setEventsFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>

            {/* Run button */}
            <button
              onClick={handleRun}
              disabled={!canRun}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ backgroundColor: '#2563eb' }}
            >
              <Play className="h-4 w-4" />
              Run Pipeline
            </button>
          </div>
        )}

        {/* ── RUNNING / DONE: stream ── */}
        {(mode === 'running' || mode === 'done') && (
          <div className="space-y-3 p-4">
            {/* Log stream */}
            <div className="rounded-xl border p-3" style={{ borderColor: '#e5dfd6', backgroundColor: '#faf8f5' }}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#9c9088' }}>
                {mode === 'running' ? 'Live activity' : 'Run log'}
              </p>
              <div className="max-h-80 overflow-y-auto">
                {logs.length === 0 ? (
                  <p className="py-4 text-center text-xs" style={{ color: '#c0b8b0' }}>Starting pipeline…</p>
                ) : (
                  logs.map((l) => <LogRow key={l.id} entry={l} />)
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
