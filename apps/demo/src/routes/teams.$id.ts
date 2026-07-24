import { createFileRoute } from "@tanstack/react-router";
import { teamByIdHandlers } from "~/server/handlers";

export const Route = createFileRoute("/teams/$id")({
  server: { handlers: teamByIdHandlers },
});
