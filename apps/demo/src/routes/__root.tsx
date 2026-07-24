/// <reference types="vite/client" />
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
} from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      {
        name: "description",
        content:
          "Live demo of versionless — one API, every version, zero handler forks.",
      },
      { title: "versionless demo" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <style>{css}</style>
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}

const css = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #0b0d10;
  color: #e6e8eb;
  font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif;
}
main { max-width: 1060px; margin: 0 auto; padding: 48px 24px 96px; }
h1 { font-size: 28px; letter-spacing: -0.02em; margin: 0 0 4px; }
h1 span { color: #6ee7b7; }
p.lede { color: #9aa3ad; margin: 0 0 40px; max-width: 62ch; }
section { margin: 32px 0; }
h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #9aa3ad; margin: 0 0 12px; }
.grid { display: grid; grid-template-columns: minmax(0, 420px) minmax(0, 1fr); gap: 24px; align-items: start; }
@media (max-width: 800px) { .grid { grid-template-columns: 1fr; } }
.actions { display: flex; flex-direction: column; gap: 8px; }
button.action {
  text-align: left; padding: 10px 14px; border-radius: 8px;
  border: 1px solid #232a32; background: #11151a; color: #e6e8eb;
  cursor: pointer; font: inherit; transition: border-color 120ms, background 120ms;
}
button.action:hover { border-color: #6ee7b7; background: #131a1f; }
button.action .title { font-weight: 600; display: block; }
button.action .pin { font-family: ui-monospace, monospace; font-size: 12px; color: #7dd3fc; }
button.action .desc { display: block; font-size: 13px; color: #9aa3ad; }
.result {
  position: sticky; top: 24px;
  border: 1px solid #232a32; border-radius: 10px; background: #0e1116;
  padding: 16px 18px; min-height: 220px;
}
.result .status { font-family: ui-monospace, monospace; font-size: 13px; margin-bottom: 8px; }
.result .status .ok { color: #6ee7b7; }
.result .status .err { color: #f87171; }
.result pre {
  margin: 0; overflow: auto; max-height: 420px;
  font: 12.5px/1.5 ui-monospace, monospace; color: #d1d5db; white-space: pre-wrap;
}
.result .headers { margin-top: 10px; font: 12px/1.6 ui-monospace, monospace; color: #9aa3ad; }
.result .headers b { color: #fbbf24; font-weight: 600; }
.hint { color: #55606b; font-size: 13px; }
`;
