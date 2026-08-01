import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LeftNav } from "@/components/left-nav";
import { AgentPanel } from "@/components/agent-panel";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Atlys Agents",
  description: "AI-powered analytics pipeline",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="h-full" style={{ backgroundColor: '#f5f1eb', color: '#1c1814' }}>
        <div className="flex h-screen overflow-hidden">
          <LeftNav />
          <main className="flex-1 overflow-y-auto min-w-0">
            {children}
          </main>
          <AgentPanel />
        </div>
      </body>
    </html>
  );
}
