import { Sidebar } from '@/components/sidebar';
import { AnalyticsChat } from '@/components/analytics-chat';

export default function ChatPage() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1">
        <AnalyticsChat className="h-full" />
      </main>
    </div>
  );
}
