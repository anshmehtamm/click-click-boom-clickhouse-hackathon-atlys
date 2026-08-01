import { Sidebar } from '@/components/sidebar';
import { InsightsFeed } from '@/components/insights-feed';

export default function InsightsPage() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto">
          <InsightsFeed />
        </div>
      </main>
    </div>
  );
}
