'use client';
import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

export const TOOL_META: Record<string, { icon: string; label: string; accent: string; bg: string }> = {
  sql_query:      { icon: '🛢', label: 'ClickHouse Query', accent: '#f59e0b', bg: '#fffbeb' },
  schema:         { icon: '🛢', label: 'Schema',           accent: '#f59e0b', bg: '#fffbeb' },
  tables:         { icon: '🛢', label: 'Tables',           accent: '#f59e0b', bg: '#fffbeb' },
  context_lookup: { icon: '🗂', label: 'Context',          accent: '#14b8a6', bg: '#f0fdfa' },
  context_index:  { icon: '🗂', label: 'Context Index',    accent: '#14b8a6', bg: '#f0fdfa' },
  skill_file:     { icon: '📘', label: 'Skill',            accent: '#7c3aed', bg: '#faf5ff' },
  skill_list:     { icon: '📘', label: 'Skill Files',      accent: '#7c3aed', bg: '#faf5ff' },
  python:         { icon: '🐍', label: 'Python',           accent: '#16a34a', bg: '#f0fdf4' },
  scratch:        { icon: '📄', label: 'Scratch File',     accent: '#64748b', bg: '#f8fafc' },
  generation:     { icon: '✦',  label: 'Generation',       accent: '#4f46e5', bg: '#eef2ff' },
  span:           { icon: '›',  label: 'Span',             accent: '#6b7280', bg: '#f9fafb' },
  other:          { icon: '·',  label: '',                 accent: '#9ca3af', bg: '#f9fafb' },
};

interface BaseWidgetProps {
  family: string;
  title: string;
  meta?: string;       // e.g. "14 rows · 12.4ms"
  error?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
  collapsedPreview?: React.ReactNode; // shown inline when collapsed
}

export function BaseWidget({
  family, title, meta, error, defaultOpen = false, children, collapsedPreview
}: BaseWidgetProps) {
  const [open, setOpen] = useState(defaultOpen);
  const tm = TOOL_META[family] ?? TOOL_META.other;
  const borderColor = error ? '#ef4444' : tm.accent + '60'; // 60 = ~38% opacity

  return (
    <div
      className="rounded-xl border overflow-hidden mb-2"
      style={{ borderColor, backgroundColor: open ? tm.bg : '#ffffff' }}
    >
      {/* Header row — always visible */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:opacity-80 transition-opacity"
        style={{ backgroundColor: open ? tm.bg : '#ffffff' }}
      >
        <span className="text-sm flex-shrink-0">{tm.icon}</span>

        <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ color: error ? '#ef4444' : tm.accent, backgroundColor: (error ? '#fef2f2' : tm.bg) }}>
          {error ? 'Error' : tm.label || family}
        </span>

        <span className="text-xs font-medium truncate flex-1" style={{ color: '#1c1814' }}>
          {title}
        </span>

        {!open && collapsedPreview && (
          <span className="text-[11px] hidden sm:block" style={{ color: '#9c9088' }}>
            {collapsedPreview}
          </span>
        )}

        {meta && (
          <span className="text-[11px] flex-shrink-0 font-mono" style={{ color: '#9c9088' }}>
            {meta}
          </span>
        )}

        <span className="flex-shrink-0" style={{ color: '#c0b8b0' }}>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>

      {/* Body — only when expanded */}
      {open && (
        <div className="border-t" style={{ borderColor }}>
          {children}
        </div>
      )}
    </div>
  );
}
