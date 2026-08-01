import { Sidebar } from '@/components/sidebar';
import { InsightsFeed } from '@/components/insights-feed';
import { TrendingUp, Database, GitBranch, Activity } from 'lucide-react';

export default function DashboardPage() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-white">Analytics Dashboard</h1>
            <p className="text-zinc-400">
              AI-powered insights from your ClickHouse data
            </p>
          </div>

          <div className="grid grid-cols-4 gap-6">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
                  <TrendingUp className="h-5 w-5 text-blue-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">--</div>
                  <div className="text-sm text-zinc-400">Total Insights</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/10">
                  <Database className="h-5 w-5 text-purple-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">--</div>
                  <div className="text-sm text-zinc-400">Schema Proposals</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/10">
                  <GitBranch className="h-5 w-5 text-green-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">--</div>
                  <div className="text-sm text-zinc-400">Context Changes</div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
                  <Activity className="h-5 w-5 text-orange-500" />
                </div>
                <div>
                  <div className="text-2xl font-bold text-white">--</div>
                  <div className="text-sm text-zinc-400">Test Runs</div>
                </div>
              </div>
            </div>
          </div>

          <InsightsFeed />
        </div>
      </main>
    </div>
  );
}
