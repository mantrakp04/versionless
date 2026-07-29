import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  IBM_Plex_Mono,
  Instrument_Serif,
} from "next/font/google";

import {
  repoUrl,
  siteDescription,
  siteName,
  siteTitle,
  siteUrl,
  socialDescription,
} from "@/lib/site";

import "./global.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "optional",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "optional",
});

const instrument = Instrument_Serif({
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400"],
  variable: "--font-instrument",
  display: "optional",
});

export const metadata: Metadata = {
  metadataBase: siteUrl,
  title: siteTitle,
  description: siteDescription,
  keywords: [
    "API versioning",
    "date-based API versions",
    "backward compatibility",
    "API transforms",
    "TypeScript",
    "OpenTelemetry",
  ],
  applicationName: siteName,
  authors: [{ name: siteName, url: repoUrl }],
  creator: siteName,
  publisher: siteName,
  category: "Developer tools",
  alternates: { canonical: "/" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    type: "website",
    siteName,
    url: "/",
    title: siteTitle,
    description: socialDescription,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: siteTitle,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: socialDescription,
    images: ["/og-image.png"],
  },
};

export const viewport = {
  themeColor: "#f1ede3",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${plexMono.variable} ${instrument.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
