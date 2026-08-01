'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, ChevronRight, Clock, CheckCircle, XCircle, RotateCcw, AlertCircle } from 'lucide-react';
import { openAgentPanel } from '@/lib/panel-context';
import type { SpecSummary } from '../api/specs/route';

const STATUS_META: Record<string, { color: string; bg: string; label: string; icon: React.ReactNode }> = {
  executed:     { color: '#16a34a', bg: '#f0fdf4', label: 'Executed',      icon: <CheckCircle className="h-3.5 w-3.5" /> },
  approved:     { color: '#2563eb', bg: '#eff6ff', label: 'Approved',      icon: <CheckCircle className="h-3.5 w-3.5" /> },
  pending_review:{ color: '#d97706', bg: '#fffbeb', label: 'Reviewing',    icon: <RotateCcw className="h-3.5 w-3.5" /> },
  needs_rework: { color: '#ea580c', bg: '#fff7ed', label: 'Reworking',     icon: <AlertCircle className="h-3.5 w-3.5" /> },
  rejected:     { color: '#dc2626', bg: '#fef2f2', label: 'Rejected',      icon: <XCircle className="h-3.5 w-3.5" /> },
};

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { color: '#9c9088', bg: '#faf8f5', label: status, icon: null };
  return (
    <span className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{ color: m.color, backgroundColor: m.bg }}>
      {m.icon}
      {m.label}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full overflow-hidden" style={{ backgroundColor: '#f0ece6' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-mono font-semibold" style={{ color }}>{pct}%</span>
    </div>
  );
}

function SpecCard({ spec }: { spec: SpecSummary }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(`/specs/${spec.spec_name}`)}
      className="w-full rounded-2xl border p-5 text-left transition-all hover:shadow-sm hover:border-blue-200"
      style={{ borderColor: '#e5dfd6', backgroundColor: '#ffffff' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 mb-1">
            <h3 className="text-sm font-semibold font-mono" style={{ color: '#1c1814' }}>
              {spec.spec_name}
            </h3>
            <StatusBadge status={spec.latest_status} />
          </div>
          {spec.table_name && (
            <p className="text-[11px] font-mono" style={{ color: '#9c9088' }}>
              {spec.table_name}
            </p>
          )}
          {spec.has_insight > 0 && spec.insight_title && (
            <p className="mt-1.5 text-xs italic truncate" style={{ color: '#7a7068' }}>
              "{spec.insight_title}"
            </p>
          )}
        </div>
        <div className="flex-shrink-0 flex flex-col items-end gap-2">
          {spec.latest_confidence > 0 && <ConfidenceBar value={spec.latest_confidence} />}
          <div className="flex items-center gap-1 text-[10px]" style={{ color: '#c0b8b0' }}>
            <Clock className="h-3 w-3" />
            {spec.last_run}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 flex-shrink-0 self-center" style={{ color: '#c0b8b0' }} />
      </div>
    </button>
  );
}

export default function SpecsPage() {
  const [specs,   setSpecs]   = useState<SpecSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/specs')
      .then(r => r.json())
      .then(d => setSpecs(Array.isArray(d) ? d : []))
      .catch(() => setSpecs([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-8 py-5"
        style={{ borderColor: '#e5dfd6' }}>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: '#1c1814' }}>Specs</h1>
          <p className="mt-0.5 text-sm" style={{ color: '#9c9088' }}>
            Feature specs that have been instrumented through the pipeline.
          </p>
        </div>
        <button
          onClick={openAgentPanel}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#2563eb' }}>
          <Plus className="h-4 w-4" />
          New Spec
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-8 py-8">
        {loading && (
          <div className="flex h-40 items-center justify-center">
            <p className="text-sm" style={{ color: '#9c9088' }}>Loading specs…</p>
          </div>
        )}

        {!loading && specs.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl mb-5"
              style={{ backgroundColor: '#f0ece6' }}>
              <Plus className="h-7 w-7" style={{ color: '#9c9088' }} />
            </div>
            <h2 className="text-base font-semibold" style={{ color: '#1c1814' }}>No specs yet</h2>
            <p className="mt-1.5 max-w-xs text-sm" style={{ color: '#9c9088' }}>
              Click <strong>New Spec</strong> and select a folder containing <code className="font-mono">spec.md</code> and <code className="font-mono">events.ndjson</code>.
            </p>
            <button
              onClick={openAgentPanel}
              className="mt-6 flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white hover:opacity-90"
              style={{ backgroundColor: '#2563eb' }}>
              <Plus className="h-4 w-4" /> New Spec
            </button>
          </div>
        )}

        {!loading && specs.length > 0 && (
          <div className="max-w-2xl space-y-3">
            {specs.map(s => <SpecCard key={s.spec_name} spec={s} />)}
          </div>
        )}
      </div>
    </div>
  );
}
