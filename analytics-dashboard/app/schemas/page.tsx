import { Database, ExternalLink } from 'lucide-react';

async function getSchemas() {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/schemas`, {
      cache: 'no-store',
    });
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch (error) {
    return [];
  }
}

export default async function SchemasPage() {
  const schemas = await getSchemas();

  return (
    <div className="p-8">
      <div className="max-w-5xl mx-auto space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-white">Schema Proposals</h1>
            <p className="text-zinc-400">
              Track ClickHouse schema proposals from the Instrumentation Agent
            </p>
          </div>

          {schemas.length === 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-12 text-center">
              <Database className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
              <p className="text-zinc-400">No schema proposals found</p>
            </div>
          ) : (
            <div className="space-y-4">
              {schemas.map((schema: any, index: number) => (
                <div
                  key={`${schema.proposal_id}-${index}`}
                  className="rounded-lg border border-zinc-800 bg-zinc-900 p-6"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-white">
                          {schema.spec_id}
                        </h3>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            schema.status === 'executed'
                              ? 'bg-green-500/10 text-green-500'
                              : schema.status === 'approved'
                              ? 'bg-blue-500/10 text-blue-500'
                              : schema.status === 'needs_rework'
                              ? 'bg-orange-500/10 text-orange-500'
                              : 'bg-zinc-500/10 text-zinc-500'
                          }`}
                        >
                          {schema.status}
                        </span>
                      </div>
                      <p className="text-sm text-zinc-400">
                        Revision {schema.revision_number} • Confidence: {Math.round(schema.confidence_score * 100)}%
                      </p>
                    </div>
                    {schema.trace_url && (
                      <a
                        href={schema.trace_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300"
                      >
                        View trace
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>

                  <div className="mt-4 space-y-3">
                    <div>
                      <h4 className="text-sm font-medium text-zinc-400 mb-2">Ordering Key Rationale</h4>
                      <p className="text-sm text-zinc-300">{schema.ordering_key_rationale}</p>
                    </div>

                    <div>
                      <h4 className="text-sm font-medium text-zinc-400 mb-2">Proposed DDL</h4>
                      <pre className="rounded-lg bg-zinc-950 p-4 text-xs text-zinc-300 overflow-x-auto">
                        {schema.proposed_ddl}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
  );
}
