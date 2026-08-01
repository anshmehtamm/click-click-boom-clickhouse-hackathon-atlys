'use client';

import { useEffect, useRef, useState, useLayoutEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { X, FolderOpen, Play, Loader2, CheckCircle, XCircle, RotateCcw } from 'lucide-react';
import { usePanelCtx } from '@/lib/panel-context';

// ── types ─────────────────────────────────────────────────────────────────────

type Mode = 'idle' | 'folder-selected' | 'running' | 'done';

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

const STAGE_COLOR: Record<string, string> = {
  init:     '#2563eb',
  trace:    '#7c3aed',
  tool:     '#d97706',
  complete: '#16a34a',
  error:    '#dc2626',
  warning:  '#d97706',
  output:   '#4a4540',
};

function stageColor(stage: string) {
  return STAGE_COLOR[stage] ?? '#9c9088';
}

function elapsedStr(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 2)  return 'now';
  if (s < 60) return `${Math.floor(s)}s`;
  return `${Math.floor(s / 60)}m`;
}

// Strip leading number prefix: "01_express_checkout" → "express_checkout"
function folderToSpecName(folder: string): string {
  return folder.replace(/^\d+_/, '');
}

// ── log row ───────────────────────────────────────────────────────────────────

function LogRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const color  = stageColor(entry.stage);
  const isLong = entry.message.length > 100;

  return (
    <div
      className="flex items-start gap-2 py-1.5 border-b last:border-0"
      style={{ borderColor: '#f0ece6', cursor: isLong ? 'pointer' : 'default' }}
      onClick={() => isLong && setExpanded(v => !v)}
    >
      <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-widest"
            style={{ color }}>{entry.stage}</span>
          <p className="flex-1 text-[11.5px]"
            style={{
              color: '#4a4540',
              whiteSpace: expanded ? 'pre-wrap' : 'nowrap',
              overflow: expanded ? 'visible' : 'hidden',
              textOverflow: expanded ? 'clip' : 'ellipsis',
              fontFamily: expanded ? 'ui-monospace, monospace' : 'inherit',
            }}>
            {entry.message}
          </p>
          <span className="flex-shrink-0 text-[10px]" style={{ color: '#c0b8b0' }}>
            {elapsedStr(entry.ts)}
          </span>
        </div>
        {isLong && !expanded && (
          <p className="text-[9px] mt-0.5" style={{ color: '#c0b8b0' }}>tap to expand</p>
        )}
      </div>
    </div>
  );
}

// ── main panel ────────────────────────────────────────────────────────────────

export function AgentPanel() {
  const { close } = usePanelCtx();
  const router    = useRouter();

  const [mode,     setMode]     = useState<Mode>('idle');
  const [specName, setSpecName] = useState('');
  const [specFile, setSpecFile] = useState<File | null>(null);
  const [eventsFile, setEventsFile] = useState<File | null>(null);
  const [logs,     setLogs]     = useState<LogEntry[]>([]);
  const [result,   setResult]   = useState<RunResult | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const folderRef  = useRef<HTMLInputElement>(null);

  // Resizable
  const [width, setWidth] = useState(400);
  const dragging   = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width]);

  useLayoutEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = dragStartX.current - e.clientX;
      setWidth(Math.min(680, Math.max(300, dragStartW.current + delta)));
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

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const addLog = (stage: string, message: string) =>
    setLogs(prev => [...prev, { id: crypto.randomUUID(), stage, message, ts: Date.now() }]);

  // ── folder picker ───────────────────────────────────────────────────────────

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    // Folder name from first file's relative path
    const folderName = files[0].webkitRelativePath.split('/')[0];
    const derivedName = folderToSpecName(folderName);

    // Find spec.md and events file
    const md   = files.find(f => f.name.endsWith('.md'));
    const ndjson = files.find(f => f.name.endsWith('.ndjson') || f.name.endsWith('.jsonl'));

    setSpecName(derivedName);
    setSpecFile(md ?? null);
    setEventsFile(ndjson ?? null);
    setMode('folder-selected');
  };

  // ── run ─────────────────────────────────────────────────────────────────────

  const handleRun = async () => {
    if (!specFile || !eventsFile) return;
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
      const dec    = new TextDecoder();

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
            } else if (data.type === 'error') {
              addLog('error', data.message);
              setResult({ status: 'failed', error: data.message });
              setMode('done');
            }
          } catch { /* bad json */ }
        }
      }
    } catch (err) {
      addLog('error', String(err));
      setResult({ status: 'failed', error: String(err) });
      setMode('done');
    }
  };

  // Auto-navigate on success
  useEffect(() => {
    if (mode === 'done' && result?.status === 'executed' && specName) {
      const t = setTimeout(() => {
        router.push(`/specs/${specName}`);
        close();
      }, 1800);
      return () => clearTimeout(t);
    }
  }, [mode, result, specName, router, close]);

  const reset = () => {
    setMode('idle');
    setLogs([]);
    setResult(null);
    setSpecName('');
    setSpecFile(null);
    setEventsFile(null);
    if (folderRef.current) folderRef.current.value = '';
  };

  const success = result?.status === 'executed';

  return (
    <div
      className="relative flex h-screen flex-shrink-0 flex-col border-l"
      style={{ width, backgroundColor: '#ffffff', borderColor: '#e5dfd6' }}
    >
      {/* Drag handle */}
      <div onMouseDown={onDragStart}
        className="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize transition-colors hover:bg-blue-400/30" />

      {/* Hidden folder input */}
      <input
        ref={folderRef}
        type="file"
        className="hidden"
        // @ts-ignore — webkitdirectory is not in standard types
        webkitdirectory=""
        multiple
        onChange={handleFolderChange}
      />

      {/* Header */}
      <div className="flex h-14 flex-shrink-0 items-center justify-between border-b px-4"
        style={{ borderColor: '#e5dfd6' }}>
        <div className="flex items-center gap-2">
          {mode === 'running' && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
          {mode === 'done' && success   && <CheckCircle className="h-4 w-4 text-green-600" />}
          {mode === 'done' && !success  && <XCircle className="h-4 w-4 text-red-500" />}
          {(mode === 'idle' || mode === 'folder-selected') && <FolderOpen className="h-4 w-4" style={{ color: '#9c9088' }} />}
          <span className="text-sm font-semibold" style={{ color: '#1c1814' }}>
            {mode === 'idle' && 'New Spec'}
            {mode === 'folder-selected' && specName}
            {mode === 'running' && `Running ${specName}…`}
            {mode === 'done' && (success ? 'Done' : 'Failed')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {mode === 'done' && (
            <button onClick={reset} className="flex items-center gap-1 text-xs hover:opacity-70"
              style={{ color: '#7a7068' }}>
              <RotateCcw className="h-3 w-3" /> Run another
            </button>
          )}
          <button onClick={() => { reset(); close(); }}
            className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-stone-100 transition-colors"
            style={{ color: '#9c9088' }}>
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">

        {/* IDLE — prompt to pick a folder */}
        {mode === 'idle' && (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ backgroundColor: '#f0ece6' }}>
              <FolderOpen className="h-7 w-7" style={{ color: '#9c9088' }} />
            </div>
            <div>
              <p className="text-sm font-medium" style={{ color: '#1c1814' }}>Select a spec folder</p>
              <p className="mt-1 text-xs" style={{ color: '#9c9088' }}>
                Pick a folder containing <code className="font-mono">spec.md</code> and <code className="font-mono">events.ndjson</code>
              </p>
            </div>
            <button
              onClick={() => folderRef.current?.click()}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: '#2563eb' }}>
              <FolderOpen className="h-4 w-4" />
              Choose folder
            </button>
          </div>
        )}

        {/* FOLDER SELECTED — confirm + run */}
        {mode === 'folder-selected' && (
          <div className="space-y-4 p-5">
            <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: '#e5dfd6', backgroundColor: '#faf8f5' }}>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#9c9088' }}>Spec name</p>
                <p className="mt-1 text-sm font-semibold font-mono" style={{ color: '#1c1814' }}>{specName}</p>
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#9c9088' }}>Spec file</p>
                  <p className="mt-1 text-xs truncate" style={{ color: specFile ? '#16a34a' : '#dc2626' }}>
                    {specFile ? `✓ ${specFile.name}` : '✗ spec.md not found'}
                  </p>
                </div>
                <div className="flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#9c9088' }}>Events file</p>
                  <p className="mt-1 text-xs truncate" style={{ color: eventsFile ? '#16a34a' : '#dc2626' }}>
                    {eventsFile ? `✓ ${eventsFile.name}` : '✗ events not found'}
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => folderRef.current?.click()}
              className="w-full rounded-xl border py-2 text-xs transition-colors hover:bg-stone-50"
              style={{ borderColor: '#e5dfd6', color: '#7a7068' }}>
              Change folder
            </button>

            <button
              onClick={handleRun}
              disabled={!specFile || !eventsFile}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ backgroundColor: '#2563eb' }}>
              <Play className="h-4 w-4" />
              Run Pipeline
            </button>
          </div>
        )}

        {/* RUNNING — live log stream */}
        {mode === 'running' && (
          <div className="p-4">
            <div className="rounded-xl border p-3" style={{ borderColor: '#e5dfd6', backgroundColor: '#faf8f5' }}>
              <div className="flex items-center gap-2 mb-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />
                <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#9c9088' }}>
                  Live output
                </p>
              </div>
              <div className="max-h-[calc(100vh-180px)] overflow-y-auto">
                {logs.length === 0 ? (
                  <p className="py-4 text-center text-xs" style={{ color: '#c0b8b0' }}>Initializing…</p>
                ) : (
                  logs.map(l => <LogRow key={l.id} entry={l} />)
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* DONE */}
        {mode === 'done' && result && (
          <div className="p-5 space-y-4">
            {/* Status banner */}
            <div className="rounded-xl border p-4"
              style={{
                borderColor: success ? '#bbf7d0' : '#fecaca',
                backgroundColor: success ? '#f0fdf4' : '#fef2f2',
              }}>
              <p className="text-sm font-semibold" style={{ color: success ? '#15803d' : '#dc2626' }}>
                {success ? '✓ Pipeline executed successfully' : `✗ Pipeline ${result.status}`}
              </p>
              {result.table_name && (
                <p className="mt-1 text-xs font-mono" style={{ color: '#1c1814' }}>{result.table_name}</p>
              )}
              {(result.error || result.reason) && (
                <p className="mt-1.5 text-xs" style={{ color: '#7f1d1d' }}>{result.error ?? result.reason}</p>
              )}
            </div>

            {/* Log summary */}
            {logs.length > 0 && (
              <details className="rounded-xl border overflow-hidden" style={{ borderColor: '#e5dfd6' }}>
                <summary className="px-4 py-2.5 text-xs font-medium cursor-pointer hover:bg-stone-50"
                  style={{ color: '#4a4540' }}>
                  Run log ({logs.length} entries)
                </summary>
                <div className="px-3 py-2 max-h-60 overflow-y-auto" style={{ backgroundColor: '#faf8f5' }}>
                  {logs.map(l => <LogRow key={l.id} entry={l} />)}
                </div>
              </details>
            )}

            {success && (
              <p className="text-center text-xs" style={{ color: '#9c9088' }}>
                Navigating to spec detail…
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
