'use client';
import { Brain } from 'lucide-react';
import type { AgentEvent } from './types';
import { getEventFamily, cleanToolName, elapsed } from './utils';
import { SqlWidget } from './widgets/SqlWidget';
import { PythonWidget } from './widgets/PythonWidget';
import { SchemaWidget, TablesWidget } from './widgets/SchemaWidget';
import { ContextLookupWidget, ContextIndexWidget } from './widgets/ContextWidget';
import { SkillFileWidget, SkillListWidget } from './widgets/SkillWidget';
import { GenerationWidget } from './widgets/GenerationWidget';

// Only thinking (reasoning/generation) and tool calls are shown here — the
// pipeline's own span/trace/plain-log bookkeeping events are real but not
// useful to a reader watching the agent work, so they're dropped rather than
// exposed behind a filter toggle.
const VISIBLE_KINDS = new Set(['reasoning', 'generation', 'tool_call']);

// ── Route event to correct widget ─────────────────────────────────────────────

// Live per-turn chain-of-thought chunk (kind="reasoning", raw text in
// `output`) -- distinct from a "generation" event's model_reasoning field
// (the FINAL turn's reasoning, attached alongside the agent's structured
// output). Same whisper visual language as GenerationWidget's reasoning
// block, but standalone since these arrive as their own live events.
function ThinkingWidget({ event }: { event: AgentEvent }) {
  const text = typeof event.output === 'string' ? event.output : '';
  if (!text.trim()) return null;
  return (
    <div className="rounded-r-lg overflow-hidden my-1" style={{ borderLeft: '2px solid #c4b5fd', backgroundColor: '#faf7ff' }}>
      <div className="px-3 pt-2 pb-1.5">
        <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: '#8b5cf6' }}>
          <Brain className="h-2.5 w-2.5" /> thinking
        </span>
        <p className="mt-1 text-[11.5px] leading-relaxed whitespace-pre-wrap font-sans" style={{ color: '#6d28d9', opacity: 0.85 }}>
          {text.trim()}
        </p>
      </div>
    </div>
  );
}

function EventWidget({ event }: { event: AgentEvent }) {
  if (event.kind === 'reasoning') return <ThinkingWidget event={event} />;

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

// ── Main component ─────────────────────────────────────────────────────────────
// No header, no filter bar, no external trace link — just the live thinking
// + tool-call feed, in order, using each event's own widget.

interface TraceViewerProps {
  events: AgentEvent[];
  className?: string;
}

export function TraceViewer({ events, className }: TraceViewerProps) {
  const visible = events.filter(ev => VISIBLE_KINDS.has(ev.kind));

  if (visible.length === 0) {
    return (
      <p className="text-center py-8 text-sm" style={{ color: '#c0b8b0' }}>
        No activity yet.
      </p>
    );
  }

  return (
    <div className={className}>
      <div className="space-y-0.5">
        {visible.map(ev => <EventWidget key={ev.id} event={ev} />)}
      </div>
    </div>
  );
}
