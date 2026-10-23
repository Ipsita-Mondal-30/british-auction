import { Suspense } from 'react';
import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from 'sonner';
import { AppHeader } from '@/components/AppHeader';
import { LiveNotifications } from '@/components/LiveNotifications';
import { UserScope } from '@/components/UserScope';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'RFQ Auctions',
  description: 'British auction bidding for freight RFQs',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col font-sans">
        <AppHeader />
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
          <UserScope>{children}</UserScope>
        </main>
        <Suspense>
          <LiveNotifications />
        </Suspense>
        {/* One toaster for the whole app. Cards are custom (lib/notify.tsx). */}
        <Toaster position="bottom-right" visibleToasts={4} gap={10} offset={24} mobileOffset={16} />
      </body>
    </html>
  );
}
