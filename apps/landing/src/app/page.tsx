import { CompatibilityMotion } from "@/components/compatibility-motion";
import { CopyInstallCommand } from "@/components/copy-install-command";
import {
  repoUrl,
  siteDescription,
  siteName,
  siteTitle,
  siteUrl,
} from "@/lib/site";

// Inlined by Next.js at build time; the landing site deliberately takes no
// @versionless/env dependency (static, env-free — see AGENTS.md). PORT_PREFIX
// is mirrored by hand for the same reason: in dev the sibling apps live on
// their own prefixed ports (see packages/env/src/ports.ts).
const isDevelopment = process.env.NODE_ENV === "development";
const portPrefix = process.env.PORT_PREFIX?.trim() || "30";

const productLinks = [
  {
    label: "docs",
    href: isDevelopment ? `http://localhost:${portPrefix}02/docs` : "/docs",
  },
  {
    label: "dashboard",
    href: isDevelopment
      ? `http://localhost:${portPrefix}01/dashboard`
      : "/dashboard",
  },
  { label: "github", href: repoUrl, external: true },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${siteUrl.toString()}#website`,
      url: siteUrl.toString(),
      name: siteName,
      description: siteDescription,
      inLanguage: "en",
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": `${siteUrl.toString()}#software`,
      name: siteName,
      url: siteUrl.toString(),
      description: siteDescription,
      codeRepository: repoUrl,
      programmingLanguage: "TypeScript",
      runtimePlatform: "JavaScript",
      license: `${repoUrl}/blob/main/LICENSE`,
      isPartOf: { "@id": `${siteUrl.toString()}#website` },
    },
  ],
};

const serializedJsonLd = JSON.stringify(jsonLd).replaceAll("<", "\\u003c");

const releases = [
  { date: "2024-11-02", note: "team → org" },
  { date: "2025-01-01", note: "add /teams alias" },
  { date: "2025-05-14", note: "flatten address" },
  { date: "2026-05-14", note: "name → first + last", current: true },
];

function ProductNav({ compact = false }: { compact?: boolean }) {
  return (
    <nav
      aria-label={compact ? "Footer navigation" : "Primary navigation"}
      className={compact ? "footer-nav" : "primary-nav"}
    >
      {productLinks.map((link) => (
        <a
          href={link.href}
          key={link.label}
          rel={link.external ? "noreferrer" : undefined}
          target={link.external ? "_blank" : undefined}
        >
          {link.label}
          {link.external ? <span aria-hidden>↗</span> : null}
        </a>
      ))}
    </nav>
  );
}

function VersionLedger() {
  return (
    <aside aria-label="Example version history" className="version-ledger">
      <div className="ledger-header">
        <span>release ledger</span>
        <span aria-hidden>live</span>
      </div>
      <ol>
        {releases.map((release, index) => (
          <li
            data-current={release.current || undefined}
            key={release.date}
            style={{ "--release-index": index } as React.CSSProperties}
          >
            <span className="ledger-dot" aria-hidden />
            <time>{release.date}</time>
            <p>{release.note}</p>
            {release.current ? <strong>current API</strong> : null}
          </li>
        ))}
      </ol>
    </aside>
  );
}

function CompatibilityCode() {
  return (
    <div className="compatibility-code" aria-label="Example Versionless change">
      <div className="compatibility-code-bar">
        <span>changes/2026-05-14.ts</span>
        <span className="code-status">request up · response down</span>
      </div>
      <pre>
        <code>
          <span className="code-keyword">export default</span>{" "}
          <span className="code-call">v.change</span>(
          <span className="code-string">&quot;2026-05-14&quot;</span>, {"{"}
          {"\n  "}request: {"{"}
          {"\n    "}up: ({"{"} name, ...user {"}"}) ={">"} {"{"}
          {"\n      "}
          <span className="code-keyword">const</span> [firstName, ...lastName] =
          name.split(<span className="code-string">&quot; &quot;</span>);
          {"\n      "}
          <span className="code-keyword">return</span> {"{"} ...user, firstName,
          lastName: lastName.join(
          <span className="code-string">&quot; &quot;</span>) {"}"};{"\n    }"},
          {"\n  }"},{"\n  "}response: {"{"}
          {"\n    "}down: ({"{"} firstName, lastName, ...user {"}"}) ={">"} (
          {"{"}
          {"\n      "}...user, name: `
          <span className="code-template">{"${firstName} ${lastName}"}</span>`,
          {"\n    }"}),
          {"\n  }"},{"\n}"});
        </code>
      </pre>
    </div>
  );
}

function Brand() {
  return (
    <>
      <img
        aria-hidden
        alt=""
        height="22"
        src="/versionless-logo.svg"
        width="68"
      />
      <span>versionless</span>
    </>
  );
}

export default function Home() {
  const docsUrl = productLinks[0].href;
  const dashboardUrl = productLinks[1].href;

  return (
    <>
      <script
        dangerouslySetInnerHTML={{ __html: serializedJsonLd }}
        type="application/ld+json"
      />

      <header className="site-header">
        <a aria-label="Versionless home" className="brand" href="/">
          <Brand />
        </a>
        <ProductNav />
        <a className="header-cta" href={docsUrl}>
          install <span aria-hidden>→</span>
        </a>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <p
              className="eyebrow reveal"
              style={{ "--stagger": 0 } as React.CSSProperties}
            >
              API compatibility without a second API
            </p>
            <h1
              className="reveal"
              style={{ "--stagger": 1 } as React.CSSProperties}
            >
              Change your API
              <em> without breaking old clients.</em>
            </h1>
            <p
              className="hero-deck reveal"
              style={{ "--stagger": 2 } as React.CSSProperties}
            >
              Keep one API. Versionless handles old clients.
            </p>
            <p
              className="hero-proof reveal"
              style={{ "--stagger": 3 } as React.CSSProperties}
            >
              No v1 folders. No duplicate handlers. No old-shape branches.
            </p>
            <div
              className="hero-actions reveal"
              style={{ "--stagger": 4 } as React.CSSProperties}
            >
              <a className="button-primary" href={docsUrl}>
                read the docs <span aria-hidden>↗</span>
              </a>
              <a className="button-link" href={dashboardUrl}>
                see the dashboard <span aria-hidden>→</span>
              </a>
            </div>
            <div
              className="reveal"
              style={{ "--stagger": 5 } as React.CSSProperties}
            >
              <CopyInstallCommand />
            </div>
          </div>
          <div
            className="reveal"
            style={{ "--stagger": 3 } as React.CSSProperties}
          >
            <VersionLedger />
          </div>
        </section>

        <section className="compatibility-section">
          <div className="section-intro section-intro-inverse">
            <p className="eyebrow">One current handler</p>
            <h2>Old shape in. New shape out.</h2>
            <p>Versionless updates the payload before your handler sees it.</p>
          </div>
          <CompatibilityMotion />
        </section>

        <section className="breaking-change">
          <div className="section-intro">
            <p className="eyebrow">Make the breaking change</p>
            <h2>Write the API you want.</h2>
            <p>Add one small translation. Old clients keep working.</p>
          </div>
          <CompatibilityCode />
        </section>

        <section className="proof-section" aria-labelledby="proof-title">
          <div className="proof-heading">
            <p className="eyebrow">Why it matters</p>
            <h2 id="proof-title">
              One API for you. No forced upgrades for customers.
            </h2>
          </div>
          <div className="proof-list">
            <article>
              <span className="proof-number">01</span>
              <div className="proof-content">
                <h3>No more v1, v2, v3, v4 forever.</h3>
                <div className="route-comparison">
                  <div>
                    <span>Instead of</span>
                    <code>
                      /v1/customers{"\n"}/v2/customers{"\n"}/v3/customers
                    </code>
                  </div>
                  <span className="comparison-arrow" aria-hidden>
                    →
                  </span>
                  <div>
                    <span>You have</span>
                    <code>/customers</code>
                  </div>
                </div>
                <p>
                  Build only the latest API. Versionless handles old clients.
                </p>
              </div>
            </article>
            <article>
              <span className="proof-number">02</span>
              <div className="proof-content">
                <h3>No forced customer migrations.</h3>
                <div className="migration-comparison">
                  <div>
                    <span>Without Versionless</span>
                    <code>
                      &quot;We&apos;re deprecating v1 in 6 months.&quot;
                    </code>
                    <p>Every customer scrambles to migrate.</p>
                  </div>
                  <div>
                    <span>With Versionless</span>
                    <ul>
                      <li>Old SDKs keep working.</li>
                      <li>Old integrations keep working.</li>
                      <li>Customers upgrade when they want.</li>
                    </ul>
                  </div>
                </div>
                <p>You own the compatibility work—not every customer.</p>
              </div>
            </article>
            <article>
              <span className="proof-number">03</span>
              <div className="proof-content">
                <h3>Refactor without fear.</h3>
                <p className="proof-lead">
                  Change the API and the architecture behind it.
                </p>
                <ul className="refactor-list">
                  <li>rename fields</li>
                  <li>split endpoints</li>
                  <li>merge endpoints</li>
                  <li>move from sync to async</li>
                  <li>redesign internal models</li>
                </ul>
                <p>
                  Improve the implementation without being trapped by old
                  contracts.
                </p>
              </div>
            </article>
          </div>
        </section>

        <section className="developer-flow">
          <div className="flow-title">
            <p className="eyebrow">Your next breaking API change</p>
            <h2>Ship it like a normal code change.</h2>
            <p>
              Versionless adds one compatibility step to the workflow you
              already have.
            </p>
          </div>
          <ol>
            <li>
              <span>01</span>
              <div>
                <strong>Change today&apos;s schema and handler.</strong>
                <p>Build the API you actually want to maintain.</p>
              </div>
              <code>name → firstName + lastName</code>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Run the surface check in CI.</strong>
                <p>It tells you what old clients would lose.</p>
              </div>
              <code>bunx versionless check</code>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Add one reversible translation.</strong>
                <p>Request in. Response out. Kept at the edge.</p>
              </div>
              <code>changes/2026-05-14.ts</code>
            </li>
            <li>
              <span>04</span>
              <div>
                <strong>Merge the current API.</strong>
                <p>New clients move forward. Old clients keep working.</p>
              </div>
              <code>✓ safe to ship</code>
            </li>
          </ol>
        </section>

        <section className="closing">
          <p className="eyebrow">Keep one API</p>
          <h2>Your product moves forward. Your clients move when ready.</h2>
          <div>
            <a className="button-primary" href={docsUrl}>
              start with the docs <span aria-hidden>↗</span>
            </a>
            <a className="button-link" href={repoUrl}>
              read the source <span aria-hidden>→</span>
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div>
          <a aria-label="Versionless home" className="brand" href="/">
            <Brand />
          </a>
          <p>One current API. Every client still works.</p>
        </div>
        <ProductNav compact />
      </footer>
    </>
  );
}
