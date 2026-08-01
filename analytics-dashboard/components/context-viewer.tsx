'use client';

import { useEffect, useState } from 'react';
import { Loader2, GitBranch, ExternalLink } from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';
import type { ContextVersion } from '@/lib/types';

export function ContextViewer() {
  const [versions, setVersions] = useState<ContextVersion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<ContextVersion | null>(null);

  useEffect(() => {
    fetchContextVersions();
  }, []);

  const fetchContextVersions = async () => {
    try {
      const response = await fetch('/api/context');
      const data = await response.json();
      setVersions(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to fetch context versions:', error);
      setVersions([]);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading context history...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-6">
      {/* Timeline */}
      <div className="col-span-1 space-y-4">
        <h2 className="text-xl font-semibold text-white">Context Timeline</h2>
        <div className="space-y-2 max-h-[calc(100vh-12rem)] overflow-y-auto">
          {versions.map((version, i) => (
            <button
              key={version.version_id}
              onClick={() => setSelectedVersion(version)}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                selectedVersion?.version_id === version.version_id
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-start gap-3">
                <GitBranch className="h-4 w-4 shrink-0 text-blue-400 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="font-medium text-white text-sm">
                    {version.section_key}
                  </div>
                  <div className="text-xs text-zinc-400">
                    by {version.changed_by_agent}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {formatRelativeTime(version.created_at)}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail View */}
      <div className="col-span-2">
        {selectedVersion ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-white">
                  {selectedVersion.section_key}
                </h2>
                {selectedVersion.trace_url && (
                  <a
                    href={selectedVersion.trace_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
                  >
                    View trace
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm text-zinc-400">
                <span>Changed by {selectedVersion.changed_by_agent}</span>
                <span>•</span>
                <span>{formatRelativeTime(selectedVersion.created_at)}</span>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <h3 className="mb-2 text-sm font-medium text-zinc-400">Change Reason</h3>
              <p className="text-zinc-300">{selectedVersion.change_reason}</p>
            </div>

            {selectedVersion.old_content && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-red-400">Old Content</h3>
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                  <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono">
                    {selectedVersion.old_content}
                  </pre>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-medium text-green-400">New Content</h3>
              <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4">
                <pre className="text-sm text-zinc-300 whitespace-pre-wrap font-mono">
                  {selectedVersion.new_content}
                </pre>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900">
            <p className="text-zinc-400">Select a version to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}
