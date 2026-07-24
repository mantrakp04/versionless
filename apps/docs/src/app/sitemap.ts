import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';
import { siteUrl } from '@/lib/shared';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: new URL('/', siteUrl).toString(),
      changeFrequency: 'weekly',
      priority: 1,
    },
    ...source.getPages().map((page) => ({
      url: new URL(page.url, siteUrl).toString(),
      changeFrequency: 'weekly' as const,
      priority: page.url === '/docs' ? 0.9 : 0.7,
    })),
  ];
}
