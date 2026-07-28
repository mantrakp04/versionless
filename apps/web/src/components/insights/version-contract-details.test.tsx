import { expect, test } from "bun:test";
import type { ProjectVersionDetail } from "@versionless/api/routers/projects";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildContractHeadline,
  buildEndpointCoverage,
  buildEndpointPresence,
  buildVersionTrend,
  compositionVerdict,
  filterEndpoints,
  inventoryQualifier,
  inventoryVerdict,
  shapeVerdict,
  summarizeInventory,
  VersionContractDetails,
} from "./version-contract-details";

const current: ProjectVersionDetail = {
  id: "00000000-0000-4000-8000-000000000010",
  version: "2026-07-24",
  uploadedAt: "2026-07-24T20:15:00.000Z",
  tool: "@versionless/cli@0.0.1",
  integrityHash: "a4063873",
  endpointCount: 2,
  modelCount: 1,
  schemaFieldCount: 3,
  httpRouteCount: 1,
  procedureCount: 1,
  methods: [{ method: "GET", count: 1 }],
  endpoints: ["GET /users/:id", "trpc:projects.list"],
  endpointDetails: [
    {
      id: "GET /users/:id",
      transport: "http",
      method: "GET",
      path: "/users/:id",
      procedure: null,
      procedureType: null,
      requestFieldCount: 1,
      responseVariantCount: 2,
    },
    {
      id: "trpc:projects.list",
      transport: "trpc",
      method: null,
      path: null,
      procedure: "projects.list",
      procedureType: "query",
      requestFieldCount: 1,
      responseVariantCount: 1,
    },
  ],
  models: ["User"],
  provenance: {
    repo: "acme/billing",
    ref: "main",
    sha: "0123456789abcdef",
  },
};

const previous: ProjectVersionDetail = {
  ...current,
  id: "00000000-0000-4000-8000-000000000009",
  version: "2026-07-21",
  endpointCount: 1,
  procedureCount: 0,
  endpoints: ["GET /users/:id"],
  endpointDetails: [
    {
      ...current.endpointDetails[0]!,
      requestFieldCount: 0,
      responseVariantCount: 1,
    },
  ],
};

test("builds endpoint coverage across uploaded versions", () => {
  expect(
    buildEndpointCoverage("trpc:projects.list", [previous, current]).map(
      ({ version, endpoint }) => ({
        version,
        present: endpoint !== null,
      }),
    ),
  ).toEqual([
    { version: "2026-07-24", present: true },
    { version: "2026-07-21", present: false },
  ]);
});

test("builds a chronological surface trend", () => {
  expect(buildVersionTrend([current, previous])).toEqual([
    {
      version: "2026-07-21",
      endpoints: 1,
      models: 1,
      procedures: 0,
    },
    {
      version: "2026-07-24",
      endpoints: 2,
      models: 1,
      procedures: 1,
    },
  ]);
});

test("leads the report with a single sentence, not a paragraph", () => {
  const headline = buildContractHeadline(
    current,
    [current, previous],
    previous,
  );

  expect(headline).toBe("2026-07-24 adds 1 endpoint against 2026-07-21.");
  expect(headline.split(". ").length).toBe(1);
});

test("says so plainly when there is no earlier version to compare", () => {
  expect(buildContractHeadline(previous, [previous])).toContain(
    "only contract on file",
  );
  expect(buildContractHeadline(previous, [previous, current])).toContain(
    "oldest contract on file",
  );
});

test("grades the surface trend as a one-word verdict", () => {
  expect(shapeVerdict(current, [current, previous])).toEqual({
    verdict: "Growing",
    tone: "positive",
  });
  expect(
    shapeVerdict({ ...current, endpointCount: 0 }, [current, previous]),
  ).toEqual({ verdict: "Shrinking", tone: "negative" });
  // The oldest upload has nothing behind it to have grown from.
  expect(shapeVerdict(previous, [current, previous])).toEqual({
    verdict: "Baseline",
    tone: "muted",
  });
  expect(shapeVerdict(current, [current])).toEqual({
    verdict: "First upload",
    tone: "muted",
  });
});

test("grades the surface mix by which transport leads it", () => {
  expect(compositionVerdict(current).verdict).toBe("HTTP-led");
  expect(
    compositionVerdict({ ...current, httpRouteCount: 1, procedureCount: 4 })
      .verdict,
  ).toBe("RPC-led");
  expect(compositionVerdict({ ...current, procedureCount: 0 }).verdict).toBe(
    "HTTP only",
  );
  expect(compositionVerdict({ ...current, httpRouteCount: 0 }).verdict).toBe(
    "RPC only",
  );
});

test("summarizes what changed in the endpoint inventory", () => {
  const versions = [current, previous];
  const summary = summarizeInventory({
    detail: current,
    previous,
    versions,
    presence: buildEndpointPresence(versions),
  });

  expect(summary).toEqual({
    total: 2,
    stable: 1,
    introduced: 1,
    dropped: 0,
  });
  expect(inventoryVerdict(summary)).toEqual({
    verdict: "Expanded",
    tone: "positive",
  });
  expect(inventoryQualifier(summary)).toBe("1 new");
});

test("reports removed endpoints against the prior version", () => {
  const versions = [previous, current];
  const summary = summarizeInventory({
    detail: previous,
    previous: current,
    versions,
    presence: buildEndpointPresence(versions),
  });

  expect(summary.dropped).toBe(1);
  expect(inventoryVerdict(summary)).toEqual({
    verdict: "Endpoints removed",
    tone: "negative",
  });
  expect(inventoryQualifier(summary)).toBe("1 removed");
});

test("filters the endpoint inventory by path and by method", () => {
  expect(
    filterEndpoints(current.endpointDetails, "users").map(
      (endpoint) => endpoint.id,
    ),
  ).toEqual(["GET /users/:id"]);
  expect(
    filterEndpoints(current.endpointDetails, "query").map(
      (endpoint) => endpoint.id,
    ),
  ).toEqual(["trpc:projects.list"]);
  expect(filterEndpoints(current.endpointDetails, "  ")).toHaveLength(2);
  expect(filterEndpoints(current.endpointDetails, "nothing")).toHaveLength(0);
});

test("renders a collapsed, numbered report of verdicts and hero numbers", () => {
  const html = renderToStaticMarkup(
    <VersionContractDetails detail={current} versions={[current, previous]} />,
  );

  expect(html).toContain("2026-07-24 adds 1 endpoint against 2026-07-21.");
  expect(html).toContain("Growing");
  expect(html).toContain("HTTP-led");
  expect(html).toContain("Expanded");
  expect(html).toContain("Shape of the contract");
  expect(html).toContain("Surface mix");
  expect(html).toContain("Endpoint inventory");
  expect(html).toContain("Artifact &amp; provenance");
  expect(html).toContain("Expand all");
  expect(html).toContain("Contract");
  expect(html).toContain("Reference");
  expect(html).toContain("acme/billing");

  // Sections stay closed so the report reads as a summary first.
  expect(html).not.toContain("/users/:id");
  expect(html).not.toContain("Surface evolution");
  expect(html).not.toContain("a4063873");
});

test("expands every section when the report is opened expanded", () => {
  const html = renderToStaticMarkup(
    <VersionContractDetails
      defaultExpanded
      detail={current}
      versions={[current, previous]}
    />,
  );

  expect(html).toContain("Surface evolution");
  expect(html).toContain("/users/:id");
  expect(html).toContain("trpc:projects.list");
  expect(html).toContain("+1 from prior");
  expect(html).toContain("py-0 font-mono leading-none");
  expect(html).toContain("translate-y-[0.5px]");
  expect(html).toContain("border-emerald-300");
  expect(html).toContain("border-indigo-300");
  expect(html).toContain("Collapse all");
  expect(html).toContain("0123456789ab");
  expect(html).not.toContain("0123456789abcdef");
});

test("shows runtime endpoint traffic separately from contract shape counts", () => {
  const html = renderToStaticMarkup(
    <VersionContractDetails
      defaultExpanded
      detail={current}
      endpointActivity={[
        {
          route: "GET /users/:id",
          requests: 4751,
          lastSeen: "2026-07-26T21:52:41.252Z",
        },
      ]}
      versions={[current, previous]}
    />,
  );

  expect(html).toContain("Requests");
  expect(html).toContain("Last seen");
  expect(html).toContain("4.8K");
  expect(html).not.toContain(">Request<");
  expect(html).not.toContain(">Responses<");
});

test("numbers reference sections after the runtime sections", () => {
  const html = renderToStaticMarkup(
    <VersionContractDetails
      detail={current}
      runtimeSectionCount={2}
      versions={[current, previous]}
    />,
  );

  expect(html).toContain(">05<");
  expect(html).toContain(">06<");
});
