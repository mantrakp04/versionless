import { getPageImage, getPageMarkdownUrl, source } from '@/lib/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { appName, gitConfig, siteUrl } from '@/lib/shared';

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;
  const pageUrl = new URL(page.url, siteUrl).toString();
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'TechArticle',
        headline: page.data.title,
        description: page.data.description,
        url: pageUrl,
        mainEntityOfPage: pageUrl,
        inLanguage: 'en',
        author: {
          '@type': 'Organization',
          name: appName,
          url: siteUrl.toString(),
        },
        publisher: {
          '@type': 'Organization',
          name: appName,
          url: siteUrl.toString(),
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Documentation',
            item: new URL('/docs', siteUrl).toString(),
          },
          ...(page.url === '/docs'
            ? []
            : [
                {
                  '@type': 'ListItem',
                  position: 2,
                  name: page.data.title,
                  item: pageUrl,
                },
              ]),
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replaceAll('<', '\\u003c'),
        }}
      />
      <main>
        <DocsPage toc={page.data.toc} full={page.data.full}>
          <DocsTitle>{page.data.title}</DocsTitle>
          <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
          <div className="flex flex-row gap-2 items-center border-b pb-6">
            <MarkdownCopyButton markdownUrl={markdownUrl} />
            <ViewOptionsPopover
              markdownUrl={markdownUrl}
              githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/content/docs/${page.path}`}
            />
          </div>
          <DocsBody>
            <MDX
              components={getMDXComponents({
                // this allows you to link to other pages with relative file paths
                a: createRelativeLink(source, page),
              })}
            />
          </DocsBody>
        </DocsPage>
      </main>
    </>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();
  const title =
    page.url === '/docs'
      ? 'versionless documentation — API versioning without route forks'
      : page.data.title;

  return {
    title: page.url === '/docs' ? { absolute: title } : title,
    description: page.data.description,
    alternates: {
      canonical: page.url,
    },
    openGraph: {
      type: 'article',
      url: page.url,
      siteName: appName,
      title,
      description: page.data.description,
      images: [
        {
          url: getPageImage(page).url,
          width: 1200,
          height: 630,
          alt: `${title} — ${appName}`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: page.data.description,
      images: [getPageImage(page).url],
    },
  };
}
