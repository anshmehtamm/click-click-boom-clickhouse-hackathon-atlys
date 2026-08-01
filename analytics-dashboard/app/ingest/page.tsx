import { Sidebar } from '@/components/sidebar';
import { SpecUpload } from '@/components/spec-upload';

export default function IngestPage() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto">
          <SpecUpload />
        </div>
      </main>
    </div>
  );
}
