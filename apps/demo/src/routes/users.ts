import { createFileRoute } from "@tanstack/react-router";
import { usersHandlers } from "~/server/handlers";

export const Route = createFileRoute("/users")({
  server: { handlers: usersHandlers },
});
