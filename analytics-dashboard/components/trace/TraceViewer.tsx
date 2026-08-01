'use client';
import { useState, useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import type { AgentEvent, ToolFamily } from './types';
import { getEventFamily, cleanToolName, elapsed } from './utils';
import { SqlWidget } from './widgets/SqlWidget';
import { PythonWidget } from './widgets/PythonWidget';
import { SchemaWidget, TablesWidget } from './widgets/SchemaWidget';
import { ContextLookupWidget, ContextIndexWidget } from './widgets/ContextWidget';
import { SkillFileWidget, SkillListWidget } from './widgets/SkillWidget';
import { GenerationWidget } from './widgets/GenerationWidget';

// ── Filter bar ────────────────────────────────────────────────────────────────

const FILTER_OPTIONS: { label: string; family: ToolFamily | 'all' }[] = [
  { label: 'All',      family: 'all' },
  { label: '🛢 SQL',   family: 'sql_query' },
  { label: '🐍 Python',family: 'python' },
  { label: '🗂 Context',family: 'context_lookup' },
  { label: '📘 Skill', family: 'skill_file' },
  { label: '✦ LLM',   family: 'generation' },
];

// ── Route event to correct widget ─────────────────────────────────────────────

function EventWidget({ event }: { event: AgentEvent }) {
  const family = getEventFamily(event);
  const clean  = cleanToolName(event.step);

  switch (family) {
    case 'sql_query':
      return <SqlWidget step={clean} input={event.input} output={event.output} />;
    case 'schema':
      return <SchemaWidget step={clean} input={event.input} output={event.output} />;
    case 'tables':
      return <TablesWidget step={clean} input={event.input} output={event.output} />;
    case 'context_lookup':
      return <ContextLookupWidget step={clean} input={event.input} output={event.output} />;
    case 'context_index':
      return <ContextIndexWidget step={clean} output={event.output} />;
    case 'skill_file':
      return <SkillFileWidget step={clean} input={event.input} output={event.output} />;
    case 'skill_list':
      return <SkillListWidget step={clean} input={event.input} output={event.output} />;
    case 'python':
      return <PythonWidget step={clean} input={event.input} output={event.output} />;
    case 'generation':
      return <GenerationWidget event={event} />;
    default:
      // Generic log / span / other — simple one-liner
      return (
        <div className="flex items-center gap-2 py-1.5 px-2 text-xs rounded"
          style={{ color: '#9c9088' }}>
          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: '#d4cfca' }} />
          <span className="font-mono">{event.step}</span>
          <span className="ml-auto text-[10px]">{elapsed(event.ts)}</span>
        </div>
      );
  }
}

// ── Trace header ──────────────────────────────────────────────────────────────

interface TraceHeaderProps {
  agent?: string;
  spec?: string;
  traceUrl?: string;
  eventCount: number;
  filter: ToolFamily | 'all';
  onFilterChange: (f: ToolFamily | 'all') => void;
}

function TraceHeader({ agent, spec, traceUrl, eventCount, filter, onFilterChange }: TraceHeaderProps) {
  return (
    <div className="border-b pb-3 mb-4 space-y-2.5" style={{ borderColor: '#e5dfd6' }}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: '#1c1814' }}>
            {agent ?? 'pipeline'} · <span style={{ color: '#9c9088' }}>{spec}</span>
          </h2>
          <p className="text-[11px]" style={{ color: '#c0b8b0' }}>{eventCount} events</p>
        </div>
        {traceUrl && (
          <a href={traceUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs font-medium hover:opacity-70"
            style={{ color: '#2563eb' }}>
            Langfuse <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-1.5">
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.family}
            onClick={() => onFilterChange(opt.family)}
            className="text-[11px] px-2.5 py-1 rounded-full border transition-colors"
            style={{
              borderColor: filter === opt.family ? '#2563eb' : '#e5dfd6',
              backgroundColor: filter === opt.family ? '#eff6ff' : '#ffffff',
              color: filter === opt.family ? '#2563eb' : '#4a4540',
              fontWeight: filter === opt.family ? 600 : 400,
            }}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface TraceViewerProps {
  events: AgentEvent[];
  traceUrl?: string;
  className?: string;
}

export function TraceViewer({ events, traceUrl, className }: TraceViewerProps) {
  const [filter, setFilter] = useState<ToolFamily | 'all'>('all');

  const agent = events.find(e => e.agent)?.agent;
  const spec  = events.find(e => e.spec)?.spec;
  const url   = traceUrl ?? events.find(e => e.trace_url)?.trace_url;

  const filtered = useMemo(() => {
    if (filter === 'all') return events;
    return events.filter(ev => {
      const f = getEventFamily(ev);
      if (filter === 'context_lookup') return f === 'context_lookup' || f === 'context_index';
      if (filter === 'skill_file')     return f === 'skill_file' || f === 'skill_list';
      return f === filter;
    });
  }, [events, filter]);

  return (
    <div className={className}>
      <TraceHeader
        agent={agent}
        spec={spec}
        traceUrl={url}
        eventCount={events.length}
        filter={filter}
        onFilterChange={setFilter}
      />
      <div className="space-y-0.5">
        {filtered.length === 0 ? (
          <p className="text-center py-8 text-sm" style={{ color: '#c0b8b0' }}>
            No events match this filter.
          </p>
        ) : (
          filtered.map(ev => <EventWidget key={ev.id} event={ev} />)
        )}
      </div>
    </div>
  );
}
