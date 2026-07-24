import { v } from "../versionless";
import { DEMO_HTTP_ROUTES } from "../api-routes";

export default v.change("2025-06-01", {
  describe: "orgs renamed to teams (/orgs/* now served by /teams/*)",
  rewrite: {
    from: DEMO_HTTP_ROUTES.legacyOrgById.key,
    to: DEMO_HTTP_ROUTES.teamById.key,
  },
  schema: (s) =>
    s.on("Team", { routesRemoved: [DEMO_HTTP_ROUTES.legacyOrgById.key] }),
});
