import { publicProcedure, router } from "../index";
import { projectsRouter } from "./projects";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  projects: projectsRouter,
});
export type AppRouter = typeof appRouter;
