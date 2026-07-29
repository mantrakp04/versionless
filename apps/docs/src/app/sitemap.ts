import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { siteUrl } from '@/lib/shared';

// Served at /docs/sitemap.xml; the landing service owns /robots.txt (which
// lists this sitemap) and the root /sitemap.xml.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...source.getPages().map((page) => ({
      url: new URL(page.url, siteUrl).toString(),
      changeFrequency: 'weekly' as const,
      priority: page.url === '/docs' ? 0.9 : 0.7,
    })),
  ];
}
