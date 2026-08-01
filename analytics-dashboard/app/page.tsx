'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle, XCircle, ExternalLink, ChevronDown, ChevronUp,
  ArrowRight, Layers,
} from 'lucide-react';
import type { RunResult } from '@/components/agent-panel';

export default function SpecsPage() {
  const [result, setResult] = useState<RunResult | null>(null);
  const [ddlOpen, setDdlOpen] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const r = (e as CustomEvent<RunResult>).detail;
      setResult(r);
      setDdlOpen(false);
    };
    window.addEventListener('spec-result', handler);
    return () => window.removeEventListener('spec-result', handler);
  }, []);

  const success = result?.status === 'executed';

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="border-b px-8 py-5" style={{ borderColor: '#e5dfd6' }}>
        <h1 className="text-lg font-semibold" style={{ color: '#1c1814' }}>Specs</h1>
        <p className="mt-0.5 text-sm" style={{ color: '#9c9088' }}>
          Submit a feature spec using the panel on the right to instrument it end-to-end.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-8">

        {/* ── Empty state ── */}
        {!result && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl mb-5"
              style={{ backgroundColor: '#f0ece6' }}>
              <Layers className="h-7 w-7" style={{ color: '#9c9088' }} />
            </div>
            <h2 className="text-base font-semibold" style={{ color: '#1c1814' }}>No spec run yet</h2>
            <p className="mt-1.5 max-w-xs text-sm leading-relaxed" style={{ color: '#9c9088' }}>
              Upload a spec and NDJSON events in the panel on the right, then hit Run Pipeline.
            </p>
            <div className="mt-6 flex items-center gap-1.5 text-sm font-medium" style={{ color: '#2563eb' }}>
              Use the panel on the right
              <ArrowRight className="h-4 w-4" />
            </div>
          </div>
        )}

        {/* ── Result card ── */}
        {result && (
          <div className="max-w-2xl space-y-4">

            {/* Status banner */}
            <div className="flex items-center gap-3 rounded-2xl border p-5"
              style={{
                borderColor: success ? '#bbf7d0' : '#fecaca',
                backgroundColor: success ? '#f0fdf4' : '#fef2f2',
              }}>
              {success
                ? <CheckCircle className="h-6 w-6 flex-shrink-0 text-green-600" />
                : <XCircle className="h-6 w-6 flex-shrink-0 text-red-500" />}
              <div className="flex-1 min-w-0">
                <p className="font-semibold" style={{ color: success ? '#15803d' : '#dc2626' }}>
                  {success ? 'Pipeline executed successfully' : `Pipeline ${result.status}`}
                </p>
                {result.table_name && (
                  <p className="mt-0.5 font-mono text-sm" style={{ color: '#1c1814' }}>
                    {result.table_name}
                  </p>
                )}
              </div>
              {result.trace_url && (
                <a href={result.trace_url} target="_blank" rel="noopener noreferrer"
                  className="flex-shrink-0 flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80"
                  style={{ backgroundColor: '#2563eb', color: '#ffffff' }}>
                  Trace <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            {/* Stats row */}
            {success && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Revisions', value: result.revisions ?? 0 },
                  { label: 'Regression', value: result.regression_passed ? 'Passed' : 'Failed' },
                  { label: 'Status', value: result.status },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-xl border px-4 py-3"
                    style={{ borderColor: '#e5dfd6', backgroundColor: '#ffffff' }}>
                    <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: '#9c9088' }}>{label}</p>
                    <p className="mt-1 text-sm font-semibold" style={{ color: '#1c1814' }}>{String(value)}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Error / reason */}
            {(result.error || result.reason) && (
              <div className="rounded-xl border px-4 py-3" style={{ borderColor: '#fecaca', backgroundColor: '#fef2f2' }}>
                <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: '#dc2626' }}>
                  {result.error ? 'Error' : 'Reason'}
                </p>
                <p className="text-sm" style={{ color: '#7f1d1d' }}>{result.error ?? result.reason}</p>
              </div>
            )}

            {/* DDL collapsible */}
            {result.ddl && (
              <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#e5dfd6' }}>
                <button
                  onClick={() => setDdlOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-stone-50"
                  style={{ backgroundColor: '#ffffff' }}
                >
                  <span className="text-sm font-medium" style={{ color: '#1c1814' }}>Generated DDL</span>
                  {ddlOpen
                    ? <ChevronUp className="h-4 w-4" style={{ color: '#9c9088' }} />
                    : <ChevronDown className="h-4 w-4" style={{ color: '#9c9088' }} />}
                </button>
                {ddlOpen && (
                  <pre className="overflow-x-auto border-t p-4 text-xs leading-relaxed"
                    style={{ borderColor: '#e5dfd6', backgroundColor: '#faf8f5', color: '#2d2520', fontFamily: 'var(--font-geist-mono)' }}>
                    {result.ddl}
                  </pre>
                )}
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
