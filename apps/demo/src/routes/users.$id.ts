import { createFileRoute } from "@tanstack/react-router";
import { userByIdHandlers } from "~/server/handlers";

export const Route = createFileRoute("/users/$id")({
  server: { handlers: userByIdHandlers },
});
