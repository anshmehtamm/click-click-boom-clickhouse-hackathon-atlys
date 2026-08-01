'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, ArrowRight, TrendingUp, AlertCircle } from 'lucide-react';

// ── types ─────────────────────────────────────────────────────────────────────

interface KnownIssue {
  issue: string;
  matching_criteria: string;
  status: 'confirmed' | 'partial' | 'contradicted' | 'untested';
}

interface ChartRow { [key: string]: string | number | null }

interface ChartData {
  rows: ChartRow[];
  n: number;
}

interface EvidenceData {
  llm?: Record<string, unknown>;
  chart_data?: {
    feature_vs_baseline_cvr?: ChartData;
    segment_breakdown?: ChartData;
    funnel_baseline?: ChartData;
    sample_size?: ChartData;
  };
}

interface Insight {
  insight_id: string;
  spec_name: string;
  title: string;
  summary: string;
  confidence: number;
  evidence: string;
  related_known_issues: string[];
  segment_cuts: string[];
  has_report: boolean;
  created_at: string;
  trace_url: string | null;
}

// ── small helpers ─────────────────────────────────────────────────────────────

function parseEvidence(raw: string): EvidenceData {
  try { return JSON.parse(raw); } catch { return {}; }
}

function parseKnownIssues(raw: string[]): KnownIssue[] {
  return raw.flatMap(s => {
    try { return [JSON.parse(s) as KnownIssue]; } catch { return []; }
  });
}

function pct(v: number | null | undefined) {
  if (v == null) return '—';
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return isNaN(n) ? '—' : `${(n * 100).toFixed(1)}%`;
}

const STATUS_COLOR: Record<string, string> = {
  confirmed:    '#16a34a',
  partial:      '#d97706',
  contradicted: '#dc2626',
  untested:     '#9c9088',
};

// ── chart components (pure CSS, no library) ───────────────────────────────────

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-2 w-full rounded-full overflow-hidden" style={{ backgroundColor: '#f0ece6' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${w}%`, backgroundColor: color }} />
    </div>
  );
}

function ConversionChart({ data }: { data: ChartData }) {
  const rows = data.rows.filter(r => r.cohort);
  if (!rows.length) return null;
  const maxRate = Math.max(...rows.map(r => parseFloat(String(r.conv_rate ?? 0))));

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9c9088' }}>
        Conversion rate
      </p>
      {rows.map((r, i) => {
        const rate = parseFloat(String(r.conv_rate ?? 0));
        const isFeature = String(r.cohort) === 'feature';
        const color = isFeature ? '#2563eb' : '#a8a29e';
        const n = Number(r.started ?? 0);
        return (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium" style={{ color: '#1c1814' }}>
                {String(r.cohort)}
                {n < 30 && <span className="ml-1.5 text-[10px]" style={{ color: '#d97706' }}>* directional</span>}
              </span>
              <span className="font-mono font-semibold" style={{ color }}>
                {pct(rate)} <span style={{ color: '#9c9088' }}>n={n.toLocaleString()}</span>
              </span>
            </div>
            <MiniBar value={rate} max={maxRate} color={color} />
          </div>
        );
      })}
    </div>
  );
}

function SegmentChart({ data }: { data: ChartData }) {
  const rows = data.rows.slice(0, 6).filter(r => r.n);
  if (!rows.length) return null;
  const maxN = Math.max(...rows.map(r => Number(r.n ?? 0)));

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9c9088' }}>
        By segment
      </p>
      {rows.map((r, i) => {
        const n = Number(r.n ?? 0);
        const label = [r.device_type, r.os, r.geoip_country_code].filter(Boolean).join(' / ') || 'unknown';
        const directional = n < 30;
        return (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="truncate max-w-[55%]" style={{ color: '#4a4540' }}>
                {label}
                {directional && <span className="ml-1 text-[10px]" style={{ color: '#d97706' }}>*</span>}
              </span>
              <span className="font-mono text-[11px]" style={{ color: '#9c9088' }}>n={n}</span>
            </div>
            <MiniBar value={n} max={maxN} color={directional ? '#f5b556' : '#2563eb'} />
          </div>
        );
      })}
      {rows.some(r => Number(r.n) < 30) && (
        <p className="text-[10px] mt-1" style={{ color: '#d97706' }}>* n&lt;30 — directional only</p>
      )}
    </div>
  );
}

function FunnelChart({ data }: { data: ChartData }) {
  const rows = data.rows.filter(r => r.step && r.users);
  if (!rows.length) return null;
  const max = Math.max(...rows.map(r => Number(r.users)));

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9c9088' }}>
        Existing funnel baseline
      </p>
      {rows.map((r, i) => {
        const n = Number(r.users);
        return (
          <div key={i} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span style={{ color: '#4a4540' }}>{String(r.step).replace(/_/g, ' ')}</span>
              <span className="font-mono text-[11px]" style={{ color: '#9c9088' }}>{n.toLocaleString()}</span>
            </div>
            <MiniBar value={n} max={max} color="#e5dfd6" />
          </div>
        );
      })}
    </div>
  );
}

function ConfidenceBar({ score }: { score: number }) {
  const pctNum = Math.round(score * 100);
  const color = pctNum >= 80 ? '#16a34a' : pctNum >= 60 ? '#d97706' : '#dc2626';
  const bg    = pctNum >= 80 ? '#f0fdf4' : pctNum >= 60 ? '#fffbeb' : '#fef2f2';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full overflow-hidden" style={{ backgroundColor: '#f0ece6' }}>
        <div className="h-full rounded-full" style={{ width: `${pctNum}%`, backgroundColor: color }} />
      </div>
      <span className="text-[11px] font-semibold rounded-full px-1.5 py-0.5"
        style={{ color, backgroundColor: bg }}>
        {pctNum}%
      </span>
    </div>
  );
}

// ── insight card ──────────────────────────────────────────────────────────────

function InsightCard({ ins }: { ins: Insight }) {
  const evidence = parseEvidence(ins.evidence);
  const cd = evidence.chart_data ?? {};
  const knownIssues = parseKnownIssues(ins.related_known_issues ?? []);
  const hasCharts = cd.feature_vs_baseline_cvr?.rows?.length || cd.segment_breakdown?.rows?.length;

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: '#e5dfd6', backgroundColor: '#ffffff' }}>
      {/* Header */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold leading-snug flex-1" style={{ color: '#1c1814' }}>
            {ins.title}
          </h3>
          <ConfidenceBar score={ins.confidence} />
        </div>
        <p className="mt-2.5 text-sm leading-relaxed" style={{ color: '#4a4540' }}>
          {ins.summary}
        </p>
      </div>

      {/* Charts */}
      {hasCharts && (
        <div className="grid gap-5 px-5 pb-5"
          style={{ gridTemplateColumns: cd.feature_vs_baseline_cvr?.rows?.length && cd.segment_breakdown?.rows?.length ? '1fr 1fr' : '1fr' }}>
          {cd.feature_vs_baseline_cvr?.rows?.length ? (
            <ConversionChart data={cd.feature_vs_baseline_cvr} />
          ) : null}
          {cd.segment_breakdown?.rows?.length ? (
            <SegmentChart data={cd.segment_breakdown} />
          ) : null}
        </div>
      )}

      {/* Funnel baseline collapsible — only show when interesting */}
      {cd.funnel_baseline?.rows?.length ? (
        <div className="px-5 pb-5">
          <FunnelChart data={cd.funnel_baseline} />
        </div>
      ) : null}

      {/* Known issues */}
      {knownIssues.length > 0 && (
        <div className="flex flex-wrap gap-2 px-5 pb-4">
          {knownIssues.map((ki, i) => (
            <span key={i} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs"
              style={{ backgroundColor: '#faf8f5', border: `1px solid #e5dfd6` }}>
              <span className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: STATUS_COLOR[ki.status] ?? '#9c9088' }} />
              <span className="font-semibold" style={{ color: '#1c1814' }}>{ki.issue}</span>
              <span style={{ color: '#9c9088' }}>{ki.matching_criteria}</span>
              <span className="font-medium" style={{ color: STATUS_COLOR[ki.status] ?? '#9c9088' }}>
                {ki.status}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-5 py-3 border-t" style={{ borderColor: '#f0ece6' }}>
        <span className="text-xs" style={{ color: '#c0b8b0' }}>
          {ins.spec_name} · {ins.created_at}
        </span>
        <div className="flex items-center gap-4">
          {ins.has_report && (
            <Link href={`/insights/${ins.insight_id}`}
              className="flex items-center gap-1 text-xs font-semibold hover:opacity-70"
              style={{ color: '#1c1814' }}>
              View full report <ArrowRight className="h-3 w-3" />
            </Link>
          )}
          {ins.trace_url && (
            <a href={ins.trace_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs font-medium hover:opacity-70"
              style={{ color: '#2563eb' }}>
              View trace <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function InsightsPage() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/insights')
      .then(r => r.json())
      .then(d => setInsights(Array.isArray(d) ? d : []))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b px-8 py-5" style={{ borderColor: '#e5dfd6' }}>
        <h1 className="text-lg font-semibold" style={{ color: '#1c1814' }}>Insights</h1>
        <p className="mt-0.5 text-sm" style={{ color: '#9c9088' }}>
          PM-ready findings generated automatically after each spec is instrumented.
          Charts use deterministic ClickHouse query results — every number traces to a logged query.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-8">
        {loading && (
          <div className="flex h-40 items-center justify-center">
            <p className="text-sm" style={{ color: '#9c9088' }}>Loading…</p>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-xl p-4" style={{ backgroundColor: '#fef2f2' }}>
            <AlertCircle className="h-4 w-4 text-red-500 flex-shrink-0" />
            <p className="text-sm" style={{ color: '#dc2626' }}>Failed to load insights — check ClickHouse connection.</p>
          </div>
        )}

        {!loading && !error && insights.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl mb-5"
              style={{ backgroundColor: '#f0ece6' }}>
              <TrendingUp className="h-7 w-7" style={{ color: '#9c9088' }} />
            </div>
            <h2 className="text-base font-semibold" style={{ color: '#1c1814' }}>No insights yet</h2>
            <p className="mt-1.5 max-w-xs text-sm" style={{ color: '#9c9088' }}>
              Insights appear automatically after a spec runs through the full pipeline.
              Submit a spec using the panel on the right.
            </p>
          </div>
        )}

        {!loading && !error && insights.length > 0 && (
          <div className="max-w-3xl space-y-6">
            {insights.map(ins => <InsightCard key={ins.insight_id} ins={ins} />)}
          </div>
        )}
      </div>
    </div>
  );
}
