import { createFileRoute } from "@tanstack/react-router";
import { teamsHandlers } from "~/server/handlers";

export const Route = createFileRoute("/teams")({
  server: { handlers: teamsHandlers },
});
