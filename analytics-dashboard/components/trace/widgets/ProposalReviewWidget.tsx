'use client';
import { useState } from 'react';
import { BaseWidget } from '../BaseWidget';
import { highlightSQL, truncate } from '../utils';
import type { AgentEvent } from '../types';

// The proposer's and reviewer's full structured output is exactly what a
// reader needs to see clearly between these two agents -- generic JSON-dump
// treatment (GenerationWidget) buries it behind a collapsed toggle. These
// parse agent_runner/schemas.py's real shapes (INSTRUMENTATION_PROPOSER_SCHEMA
// / CONTEXT_REVIEWER_SCHEMA) into real structure: DDL as a code block,
// candidates/findings as their own cards, not a wall of raw text.

function parseOutput(output: unknown): Record<string, any> | null {
  if (output && typeof output === 'object') return output as Record<string, any>;
  if (typeof output === 'string') {
    try { return JSON.parse(output); } catch { return null; }
  }
  return null;
}

function ConfidenceBadge({ value }: { value?: number }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? '#16a34a' : pct >= 60 ? '#d97706' : '#dc2626';
  return (
    <span className="text-[11px] font-mono font-semibold tabular-nums px-1.5 py-0.5 rounded"
      style={{ color, backgroundColor: color + '15' }}>
      {pct}% confidence
    </span>
  );
}

function Prose({ label, text, accent }: { label: string; text: string; accent: string }) {
  if (!text) return null;
  return (
    <div className="rounded-lg px-3 py-2.5 text-sm leading-relaxed"
      style={{ backgroundColor: accent + '10', color: accent, border: `1px solid ${accent}30` }}>
      <span className="text-[9px] font-bold uppercase tracking-widest block mb-1" style={{ opacity: 0.85 }}>
        {label}
      </span>
      <span style={{ opacity: 0.9 }}>{text}</span>
    </div>
  );
}

function CodeBlock({ code, lang }: { code: string; lang?: 'sql' }) {
  const [open, setOpen] = useState(true);
  const lines = code.split('\n');
  const long = lines.length > 6;
  const shown = open ? code : lines.slice(0, 6).join('\n') + (long ? '\n…' : '');
  return (
    <div>
      <pre className="text-[11px] p-3 rounded-lg overflow-x-auto font-mono leading-relaxed"
        style={{ backgroundColor: '#0f0e0c', color: '#e8e4df', border: '1px solid #2d2a20' }}
        dangerouslySetInnerHTML={lang === 'sql' ? { __html: highlightSQL(shown) } : undefined}>
        {lang === 'sql' ? undefined : shown}
      </pre>
      {long && (
        <button onClick={() => setOpen(v => !v)}
          className="text-[10px] mt-1 hover:opacity-70" style={{ color: '#9c9088' }}>
          {open ? 'collapse ▲' : `show all ${lines.length} lines ▼`}
        </button>
      )}
    </div>
  );
}

// ── Proposal ──────────────────────────────────────────────────────────────────

export function ProposalWidget({ event }: { event: AgentEvent }) {
  const parsed = parseOutput(event.output);
  if (!parsed) return <FallbackRaw event={event} family="proposal" title="proposal" />;

  const {
    table_name, columns_ddl, ordering_key_candidates = [], column_mapping = [],
    materialized_views = [], confidence, rationale,
  } = parsed;

  return (
    <BaseWidget
      family="proposal"
      title={table_name || 'proposal'}
      meta={undefined}
      defaultOpen
      collapsedPreview={<span className="italic">{truncate(rationale ?? '', 60)}</span>}
    >
      <div className="p-3.5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {table_name && (
            <span className="text-[12px] font-mono font-semibold px-2 py-0.5 rounded" style={{ color: '#1c1814', backgroundColor: '#f0ece6' }}>
              {table_name}
            </span>
          )}
          <ConfidenceBadge value={confidence} />
        </div>

        {rationale && <Prose label="proposer's rationale" text={rationale} accent="#d97706" />}

        {columns_ddl && (
          <div>
            <span className="text-[9.5px] font-bold uppercase tracking-widest block mb-1" style={{ color: '#9c9088' }}>
              columns DDL
            </span>
            <CodeBlock code={columns_ddl} lang="sql" />
          </div>
        )}

        {ordering_key_candidates.length > 0 && (
          <div>
            <span className="text-[9.5px] font-bold uppercase tracking-widest block mb-1" style={{ color: '#9c9088' }}>
              ordering key candidates ({ordering_key_candidates.length})
            </span>
            <div className="space-y-1.5">
              {ordering_key_candidates.map((c: any, i: number) => (
                <div key={i} className="rounded-lg border p-2.5 text-[11.5px]" style={{ borderColor: '#e5dfd6', backgroundColor: '#faf8f5' }}>
                  <div className="font-semibold" style={{ color: '#1c1814' }}>{c.label}</div>
                  <div className="font-mono mt-0.5" style={{ color: '#7a7068' }}>
                    ORDER BY {c.ordering_key} {c.partition_key && <>· PARTITION BY {c.partition_key}</>}
                  </div>
                  {c.rationale && <div className="mt-1" style={{ color: '#9c9088' }}>{c.rationale}</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {materialized_views.length > 0 && (
          <div>
            <span className="text-[9.5px] font-bold uppercase tracking-widest block mb-1" style={{ color: '#9c9088' }}>
              materialized views ({materialized_views.length})
            </span>
            <div className="space-y-2">
              {materialized_views.map((mv: any, i: number) => (
                <div key={i} className="rounded-lg border p-2.5" style={{ borderColor: '#e5dfd6', backgroundColor: '#faf8f5' }}>
                  <div className="text-[11.5px] font-mono font-semibold mb-1" style={{ color: '#1c1814' }}>{mv.name}</div>
                  {mv.ddl && <CodeBlock code={mv.ddl} lang="sql" />}
                </div>
              ))}
            </div>
          </div>
        )}

        {column_mapping.length > 0 && (
          <div>
            <span className="text-[9.5px] font-bold uppercase tracking-widest block mb-1" style={{ color: '#9c9088' }}>
              column mapping ({column_mapping.length})
            </span>
            <div className="rounded-lg border overflow-hidden" style={{ borderColor: '#e5dfd6' }}>
              <table className="text-[11px] w-full">
                <tbody>
                  {column_mapping.map((m: any, i: number) => (
                    <tr key={i} className="border-b last:border-0" style={{ borderColor: '#f0ece6' }}>
                      <td className="px-2.5 py-1 font-mono" style={{ color: '#9c9088' }}>{m.raw_field}</td>
                      <td className="px-2.5 py-1 font-mono" style={{ color: '#1c1814' }}>→ {m.column_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </BaseWidget>
  );
}

// ── Review ────────────────────────────────────────────────────────────────────

const VERDICT_META: Record<string, { label: string; color: string }> = {
  approve:         { label: 'Approved',        color: '#16a34a' },
  request_changes: { label: 'Changes Requested', color: '#d97706' },
  block:           { label: 'Blocked',         color: '#dc2626' },
};

const SEVERITY_META: Record<string, { color: string }> = {
  block: { color: '#dc2626' }, warn: { color: '#d97706' }, info: { color: '#2563eb' },
};

export function ReviewWidget({ event }: { event: AgentEvent }) {
  const parsed = parseOutput(event.output);
  if (!parsed) return <FallbackRaw event={event} family="review" title="review" />;

  const { verdict, findings = [], reviewer_confidence } = parsed;
  const vm = VERDICT_META[verdict] ?? { label: verdict ?? 'unknown', color: '#6b7280' };

  return (
    <BaseWidget
      family="review"
      title={vm.label}
      meta={undefined}
      defaultOpen
      collapsedPreview={<span className="italic">{findings.length} finding{findings.length !== 1 ? 's' : ''}</span>}
    >
      <div className="p-3.5 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11.5px] font-bold px-2 py-0.5 rounded" style={{ color: vm.color, backgroundColor: vm.color + '15' }}>
            {vm.label}
          </span>
          <ConfidenceBadge value={reviewer_confidence} />
        </div>

        {findings.length === 0 ? (
          <p className="text-[11.5px]" style={{ color: '#9c9088' }}>No findings.</p>
        ) : (
          <div className="space-y-1.5">
            {findings.map((f: any, i: number) => {
              const sm = SEVERITY_META[f.severity] ?? { color: '#6b7280' };
              return (
                <div key={i} className="rounded-lg border p-2.5" style={{ borderColor: sm.color + '35', backgroundColor: sm.color + '08' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[9.5px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                      style={{ color: sm.color, backgroundColor: sm.color + '18' }}>
                      {f.severity}
                    </span>
                    {f.category && <span className="text-[10.5px] font-mono" style={{ color: '#9c9088' }}>{f.category}</span>}
                  </div>
                  {f.description && <p className="text-[11.5px] leading-relaxed" style={{ color: '#1c1814' }}>{f.description}</p>}
                  {f.suggested_fix && (
                    <p className="text-[11px] leading-relaxed mt-1" style={{ color: '#7a7068' }}>
                      <span className="font-semibold">fix: </span>{f.suggested_fix}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </BaseWidget>
  );
}

// Fallback if output somehow doesn't parse as JSON (shouldn't happen — the
// proposer/reviewer are both strict-json_schema constrained — but never
// silently show nothing).
function FallbackRaw({ event, family, title }: { event: AgentEvent; family: string; title: string }) {
  const text = typeof event.output === 'string' ? event.output : JSON.stringify(event.output, null, 2);
  return (
    <BaseWidget family={family} title={title} defaultOpen>
      <pre className="p-3.5 text-[11px] font-mono whitespace-pre-wrap overflow-x-auto" style={{ color: '#4a4540' }}>
        {text}
      </pre>
    </BaseWidget>
  );
}
