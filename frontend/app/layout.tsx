import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Clinical RAG Assistant - AI Ingestion & Search',
  description: 'AI-powered clinical guidelines ingestion and semantic retrieval system.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
