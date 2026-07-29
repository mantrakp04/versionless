import {
  Card,
  CardContent,
  CardHeader,
} from "@versionless/ui/components/card";
import { Skeleton } from "@versionless/ui/components/skeleton";

const APP_SHELL_NAV_ITEMS = Array.from({ length: 5 }, (_, index) => index);
const CARD_ROWS = Array.from({ length: 6 }, (_, index) => index);
const SUNSET_ROWS = Array.from({ length: 5 }, (_, index) => index);
const CHART_BAR_WIDTHS = [78, 64, 91, 53, 72, 45] as const;

function PageHeaderSkeleton() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Skeleton className="h-6 w-36" />
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-44" />
      </div>
    </div>
  );
}

function ContentCardSkeleton({ tall = false }: { tall?: boolean }) {
  return (
    <Card aria-hidden="true">
      <CardHeader className="space-y-2">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-3 w-full max-w-xl" />
      </CardHeader>
      <CardContent className="space-y-3">
        {CARD_ROWS.slice(0, tall ? 6 : 3).map((index) => (
          <div className="flex items-center gap-4" key={index}>
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function PageSkeletonContent() {
  return (
    <>
      <PageHeaderSkeleton />
      <div className="grid gap-4 lg:grid-cols-2">
        <ContentCardSkeleton tall />
        <ContentCardSkeleton />
      </div>
    </>
  );
}

/** Route-sized fallback used after the persistent dashboard shell is visible. */
export default function Loader() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading page"
      className="container mx-auto max-w-6xl space-y-6 px-4 py-4"
      role="status"
    >
      <PageSkeletonContent />
      <span className="sr-only">Loading page</span>
    </div>
  );
}

/** Initial bootstrap fallback, shaped like the sidebar and content it replaces. */
export function AppShellSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading dashboard"
      className="flex h-svh w-full bg-background"
      role="status"
    >
      <aside
        aria-hidden="true"
        className="hidden w-64 shrink-0 border-r p-3 md:flex md:flex-col"
      >
        <div className="flex h-8 items-center gap-2">
          <Skeleton className="h-8 flex-1" />
          <Skeleton className="size-8" />
        </div>
        <div className="mt-7 space-y-3">
          <Skeleton className="h-3 w-20" />
          {APP_SHELL_NAV_ITEMS.map((index) => (
            <div className="flex h-8 items-center gap-3" key={index}>
              <Skeleton className="size-4 shrink-0" />
              <Skeleton
                className="h-3"
                style={{ width: `${62 + (index % 3) * 9}%` }}
              />
            </div>
          ))}
        </div>
        <div className="mt-auto space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-hidden">
        <div
          aria-hidden="true"
          className="flex h-14 items-center gap-3 border-b px-4 md:hidden"
        >
          <Skeleton className="size-8" />
          <Skeleton className="h-5 w-24" />
        </div>
        <div
          aria-hidden="true"
          className="container mx-auto max-w-6xl space-y-6 px-4 py-4"
        >
          <PageSkeletonContent />
        </div>
      </main>
      <span className="sr-only">Loading dashboard</span>
    </div>
  );
}

export function SunsetCardSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Loading sunset blockers" role="status">
      <CardHeader className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-full max-w-lg" />
      </CardHeader>
      <CardContent className="space-y-4">
        <Skeleton className="h-8 w-44" />
        <div className="space-y-3 rounded-md border p-3">
          <div className="grid grid-cols-[2fr_1fr_1fr] gap-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-16 justify-self-end" />
            <Skeleton className="h-3 w-14 justify-self-end" />
          </div>
          {SUNSET_ROWS.map((index) => (
            <div
              className="grid grid-cols-[2fr_1fr_1fr] gap-4 border-t pt-3"
              key={index}
            >
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-12 justify-self-end" />
              <Skeleton className="h-3 w-16 justify-self-end" />
            </div>
          ))}
        </div>
      </CardContent>
      <span className="sr-only">Loading sunset blockers</span>
    </Card>
  );
}

export function HorizontalBarChartSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading version overhead chart"
      className="space-y-3 py-2"
      role="status"
    >
      {CHART_BAR_WIDTHS.map((width, index) => (
        <div
          aria-hidden="true"
          className="grid grid-cols-[8.5rem_1fr] items-center gap-3"
          key={index}
        >
          <Skeleton
            className="h-3 justify-self-end"
            style={{ width: `${48 + (index % 3) * 16}%` }}
          />
          <Skeleton className="h-5 rounded-sm" style={{ width: `${width}%` }} />
        </div>
      ))}
      <div aria-hidden="true" className="ml-[9.25rem] flex gap-4 pt-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-20" />
      </div>
      <span className="sr-only">Loading version overhead chart</span>
    </div>
  );
}
