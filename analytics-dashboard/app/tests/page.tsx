import { Sidebar } from '@/components/sidebar';
import { Activity, CheckCircle, XCircle, Minus } from 'lucide-react';

export default function TestsPage() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold text-white">Test Runs</h1>
            <p className="text-zinc-400">
              Track test execution results for schema proposals
            </p>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-12 text-center">
            <Activity className="h-12 w-12 text-zinc-600 mx-auto mb-4" />
            <p className="text-zinc-400">Test run history will appear here</p>
            <p className="text-sm text-zinc-500 mt-2">
              Connect to ClickHouse to view test results
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
