import { createFileRoute } from "@tanstack/react-router";
import { handleRpc } from "~/server/rpc";

const handle = ({ request }: { request: Request }) => handleRpc(request);

export const Route = createFileRoute("/rpc/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
});
