import type { Metadata } from 'next';
import { Geist, Instrument_Serif } from 'next/font/google';
import { LangProvider } from '@/lib/i18n';
import './globals.css';

const sans = Geist({ subsets: ['latin', 'latin-ext'], variable: '--font-sans' });
const serif = Instrument_Serif({ subsets: ['latin', 'latin-ext'], weight: '400', variable: '--font-serif' });

export const metadata: Metadata = {
  title: 'Council',
  description: 'Coding agents debate a codebase or an idea. Watch it live, replay it later.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // theme.js may set data-theme before React hydrates, hence suppressHydrationWarning.
    <html lang="en" className={`${sans.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        {/* The saved theme must apply before first paint (static export, no inline scripts under the CSP). */}
        <script src="/theme.js" />
      </head>
      <body><LangProvider>{children}</LangProvider></body>
    </html>
  );
}
