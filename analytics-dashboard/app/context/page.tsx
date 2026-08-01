import { Sidebar } from '@/components/sidebar';
import { ContextViewer } from '@/components/context-viewer';

export default function ContextPage() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-7xl mx-auto">
          <ContextViewer />
        </div>
      </main>
    </div>
  );
}
