import { createFileRoute } from "@tanstack/react-router";

import { VersionsPage } from "@/components/insights/versions-page";

export const Route = createFileRoute("/insights/$projectId/versions/")({
  component: VersionsPage,
});
