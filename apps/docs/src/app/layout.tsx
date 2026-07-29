import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import type { Metadata, Viewport } from 'next';
import { appName, siteDescription, siteUrl } from '@/lib/shared';

export const metadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: appName,
  title: {
    default: 'versionless — API versioning without route forks',
    template: '%s | versionless',
  },
  description: siteDescription,
  keywords: [
    'API versioning',
    'date-based API versions',
    'backward compatibility',
    'API transforms',
    'TypeScript',
    'OpenTelemetry',
  ],
  authors: [{ name: 'versionless', url: siteUrl }],
  creator: 'versionless',
  publisher: 'versionless',
  category: 'Developer tools',
  alternates: {
    canonical: '/docs',
  },
  openGraph: {
    type: 'website',
    url: '/docs',
    siteName: appName,
    title: 'versionless — API versioning without route forks',
    description: siteDescription,
    images: [
      {
        url: '/og/docs/image.png',
        width: 1200,
        height: 630,
        alt: 'versionless documentation',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'versionless — API versioning without route forks',
    description: siteDescription,
    images: ['/og/docs/image.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.ico',
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  manifest: '/site.webmanifest',
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#111111' },
  ],
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
