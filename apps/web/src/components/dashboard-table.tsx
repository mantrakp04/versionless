import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  useInfiniteQuery,
  type InfiniteData,
  type QueryKey,
  type UseInfiniteQueryOptions,
} from "@tanstack/react-query";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@versionless/ui/components/table";
import { Skeleton } from "@versionless/ui/components/skeleton";
import { cn } from "@versionless/ui/lib/utils";

type PageWithItems<TItem> = {
  items: TItem[];
};

interface NavigationState {
  index: number;
  itemKey?: string;
}

const navigationMemory = new Map<string, NavigationState>();
const STORAGE_PREFIX = "versionless:virtual-table:";
const DEFAULT_SKELETON_WIDTHS = ["70%", "45%", "60%", "55%"] as const;

export interface VirtualTableSkeletonOptions {
  rows?: number;
  rowHeight?: number;
  columnWidths?: readonly string[];
}

interface DashboardTableSharedProps<TItem> {
  renderHeader: () => ReactNode;
  renderRow: (item: TItem, index: number) => ReactNode;
  emptyState?: ReactNode;
  errorState?: ReactNode;
  className?: string;
}

interface DashboardTableProps<TItem> extends DashboardTableSharedProps<TItem> {
  items: TItem[];
  getItemKey: (item: TItem, index: number) => string;
  isLoading?: boolean;
  isError?: boolean;
  skeleton?: VirtualTableSkeletonOptions;
  selectedKey?: string | null;
  onRowActivate?: (item: TItem, index: number) => void;
  isRowExpanded?: (item: TItem, index: number) => boolean;
  renderExpandedRow?: (item: TItem, index: number) => ReactNode;
  columnCount?: number;
  expandedCellClassName?: string;
}

export function getNextActiveIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
): number | null {
  if (itemCount === 0) return null;
  if (key === "j" || key === "ArrowDown") {
    return Math.min(currentIndex + 1, itemCount - 1);
  }
  if (key === "k" || key === "ArrowUp") {
    return Math.max(currentIndex - 1, 0);
  }
  return null;
}

export function virtualTableStorageKey(navigationKey: string): string {
  return `${STORAGE_PREFIX}${navigationKey}`;
}

export function resolveRestoredIndex<TItem>(
  items: TItem[],
  state: NavigationState,
  getItemKey: (item: TItem) => string,
): number {
  if (items.length === 0) return 0;
  const keyedIndex = state.itemKey
    ? items.findIndex((item) => getItemKey(item) === state.itemKey)
    : -1;
  return keyedIndex >= 0 ? keyedIndex : Math.min(state.index, items.length - 1);
}

export function navigationStateAtIndex<TItem>(
  items: TItem[],
  index: number,
  getItemKey: (item: TItem) => string,
): NavigationState | null {
  const item = items[index];
  return item ? { index, itemKey: getItemKey(item) } : null;
}

function readNavigationState(navigationKey: string): NavigationState {
  const remembered = navigationMemory.get(navigationKey);
  if (remembered) return remembered;
  if (typeof window === "undefined") return { index: 0 };

  try {
    const serialized = window.sessionStorage.getItem(
      virtualTableStorageKey(navigationKey),
    );
    return serialized
      ? (JSON.parse(serialized) as NavigationState)
      : { index: 0 };
  } catch {
    return { index: 0 };
  }
}

function rememberNavigationState(
  navigationKey: string,
  state: NavigationState,
) {
  navigationMemory.set(navigationKey, state);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      virtualTableStorageKey(navigationKey),
      JSON.stringify(state),
    );
  } catch {
    // Session storage is an optional enhancement; in-memory preservation remains.
  }
}

function SkeletonCells({ columnWidths }: { columnWidths: readonly string[] }) {
  return columnWidths.map((width, columnIndex) => (
    <TableCell aria-hidden="true" key={columnIndex}>
      <Skeleton className="h-3" style={{ width }} />
    </TableCell>
  ));
}

export function DashboardTableSkeleton({
  gridTemplateColumns,
  renderHeader,
  rows = 5,
  rowHeight = 36,
  columnWidths = DEFAULT_SKELETON_WIDTHS,
  className,
}: {
  gridTemplateColumns?: string;
  renderHeader: () => ReactNode;
  rows?: number;
  rowHeight?: number;
  columnWidths?: readonly string[];
  className?: string;
}) {
  const grid = gridTemplateColumns !== undefined;
  return (
    <div
      aria-busy="true"
      aria-label="Loading table"
      className={cn("rounded-md", className)}
      role="status"
    >
      <Table className={grid ? "grid" : undefined}>
        <TableHeader className={grid ? "grid" : undefined}>
          <TableRow
            className={
              grid
                ? "grid [&_[data-slot=table-head]]:flex [&_[data-slot=table-head]]:items-center"
                : undefined
            }
            style={grid ? { gridTemplateColumns } : undefined}
          >
            {renderHeader()}
          </TableRow>
        </TableHeader>
        <TableBody className={grid ? "grid" : undefined}>
          {Array.from({ length: rows }, (_, rowIndex) => (
            <TableRow
              aria-hidden="true"
              className={cn(grid && "grid", "items-center")}
              data-skeleton-row
              key={rowIndex}
              style={
                grid
                  ? { gridTemplateColumns, minHeight: rowHeight }
                  : { minHeight: rowHeight }
              }
            >
              <SkeletonCells columnWidths={columnWidths} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <span className="sr-only">Loading table rows</span>
    </div>
  );
}

export function DashboardTable<TItem>({
  items,
  getItemKey,
  renderHeader,
  renderRow,
  isLoading = false,
  isError = false,
  skeleton,
  selectedKey,
  onRowActivate,
  isRowExpanded,
  renderExpandedRow,
  columnCount,
  expandedCellClassName,
  emptyState = "No results in this window.",
  errorState = "Unable to load results.",
  className,
}: DashboardTableProps<TItem>) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Selection styling is driven by selectedKey; the active index only feeds
  // the keyboard handler, so a ref keeps hover tracking render-free.
  const activeIndexRef = useRef(0);
  const interactive = onRowActivate !== undefined;

  const selectIndex = (index: number) => {
    const item = items[index];
    if (!item || !onRowActivate) return;
    activeIndexRef.current = index;
    onRowActivate(item, index);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      !interactive ||
      event.target !== event.currentTarget ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return;
    }
    const nextIndex = getNextActiveIndex(
      event.key,
      activeIndexRef.current,
      items.length,
    );
    if (nextIndex === null) return;
    event.preventDefault();
    if (nextIndex === activeIndexRef.current) return;
    selectIndex(nextIndex);
  };

  if (isLoading) {
    return (
      <DashboardTableSkeleton
        renderHeader={renderHeader}
        rows={skeleton?.rows}
        rowHeight={skeleton?.rowHeight}
        columnWidths={skeleton?.columnWidths}
        className={className}
      />
    );
  }
  if (isError) {
    return (
      <div className="py-8 text-center text-xs text-destructive">
        {errorState}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        {emptyState}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      aria-label={interactive ? "Keyboard navigable data table" : undefined}
      className={cn(
        "rounded-md",
        interactive &&
          "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      onKeyDown={interactive ? handleKeyDown : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <Table>
        <TableHeader>
          <TableRow>{renderHeader()}</TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => {
            const key = getItemKey(item, index);
            const expanded = isRowExpanded?.(item, index) ?? false;
            return (
              <Fragment key={key}>
                <TableRow
                  aria-expanded={renderExpandedRow ? expanded : undefined}
                  aria-selected={interactive ? key === selectedKey : undefined}
                  className={cn(interactive && "cursor-pointer")}
                  data-row-key={key}
                  data-state={key === selectedKey ? "selected" : undefined}
                  onClick={
                    interactive
                      ? () => {
                          selectIndex(index);
                          containerRef.current?.focus({
                            preventScroll: true,
                          });
                        }
                      : undefined
                  }
                  onPointerEnter={
                    interactive
                      ? () => {
                          activeIndexRef.current = index;
                        }
                      : undefined
                  }
                >
                  {renderRow(item, index)}
                </TableRow>
                {expanded && renderExpandedRow ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      className={expandedCellClassName}
                      colSpan={columnCount}
                    >
                      {renderExpandedRow(item, index)}
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
      {interactive ? (
        <p className="sr-only">
          Focus the table and use J, K, or the arrow keys to move between rows.
        </p>
      ) : null}
    </div>
  );
}

export function InfiniteDashboardTable<
  TItem,
  TPage extends PageWithItems<TItem>,
  TError,
  TQueryKey extends QueryKey,
  TPageParam,
>({
  queryOptions,
  navigationKey,
  getItemKey,
  gridTemplateColumns,
  renderHeader,
  renderRow,
  estimateRowHeight = 36,
  skeleton,
  emptyState = "No results in this window.",
  errorState = "Unable to load results.",
  className,
}: {
  queryOptions: UseInfiniteQueryOptions<
    TPage,
    TError,
    InfiniteData<TPage, TPageParam>,
    TQueryKey,
    TPageParam
  >;
  navigationKey: string;
  getItemKey: (item: TItem) => string;
  gridTemplateColumns: string;
  renderHeader: () => ReactNode;
  renderRow: (item: TItem, index: number) => ReactNode;
  estimateRowHeight?: number;
  skeleton?: VirtualTableSkeletonOptions;
  emptyState?: ReactNode;
  errorState?: ReactNode;
  className?: string;
}) {
  const query = useInfiniteQuery(queryOptions);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);
  const navigationContainerRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState<number | null>(null);
  const navigationStateRef = useRef<{
    key: string;
    state: NavigationState;
  } | null>(null);
  if (
    navigationStateRef.current === null ||
    navigationStateRef.current.key !== navigationKey
  ) {
    navigationStateRef.current = {
      key: navigationKey,
      state: readNavigationState(navigationKey),
    };
  }
  const [activeIndex, setActiveIndex] = useState(
    navigationStateRef.current.state.index,
  );
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const rowCount = items.length + (query.hasNextPage ? 1 : 0);
  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => estimateRowHeight,
    overscan: 6,
    scrollMargin: scrollMargin ?? 0,
    getItemKey: (index) =>
      index < items.length ? getItemKey(items[index] as TItem) : "loader",
  });
  const virtualRows = virtualizer.getVirtualItems();
  const lastVirtualIndex = virtualRows.at(-1)?.index ?? -1;

  useEffect(() => {
    const tableBody = tableBodyRef.current;
    if (!tableBody) return;

    const measureScrollMargin = () => {
      const nextScrollMargin =
        tableBody.getBoundingClientRect().top + window.scrollY;
      setScrollMargin((current) =>
        current === nextScrollMargin ? current : nextScrollMargin,
      );
    };

    measureScrollMargin();
    window.addEventListener("resize", measureScrollMargin);
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measureScrollMargin);
    resizeObserver?.observe(tableBody);

    return () => {
      window.removeEventListener("resize", measureScrollMargin);
      resizeObserver?.disconnect();
    };
  }, [items.length]);

  useEffect(() => {
    if (
      lastVirtualIndex >= items.length - 1 &&
      query.hasNextPage &&
      !query.isFetchingNextPage
    ) {
      void query.fetchNextPage();
    }
  }, [
    items.length,
    lastVirtualIndex,
    query.fetchNextPage,
    query.hasNextPage,
    query.isFetchingNextPage,
  ]);

  useEffect(() => {
    if (items.length === 0 || scrollMargin === null) return;
    const restoredState = navigationStateRef.current?.state ?? { index: 0 };
    const restoredItemIndex = restoredState.itemKey
      ? items.findIndex((item) => getItemKey(item) === restoredState.itemKey)
      : -1;
    const nextIndex = resolveRestoredIndex(items, restoredState, getItemKey);
    setActiveIndex(nextIndex);

    if (
      restoredItemIndex < 0 &&
      restoredState.index >= items.length &&
      query.hasNextPage &&
      !query.isFetchingNextPage
    ) {
      void query.fetchNextPage();
      return;
    }
    virtualizer.scrollToIndex(nextIndex, { align: "auto" });
  }, [
    getItemKey,
    items,
    query.fetchNextPage,
    query.hasNextPage,
    query.isFetchingNextPage,
    scrollMargin,
    virtualizer,
  ]);

  // Hover tracking stays in memory only; the sessionStorage write (JSON
  // serialization + synchronous I/O) is reserved for click/keyboard activation.
  const trackIndex = (index: number): NavigationState | null => {
    const state = navigationStateAtIndex(items, index, getItemKey);
    if (!state) return null;
    setActiveIndex(index);
    if (navigationStateRef.current) {
      navigationStateRef.current.state = state;
    }
    navigationMemory.set(navigationKey, state);
    return state;
  };

  const selectIndex = (index: number) => {
    const state = trackIndex(index);
    if (state) rememberNavigationState(navigationKey, state);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target !== event.currentTarget ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return;
    }
    const nextIndex = getNextActiveIndex(event.key, activeIndex, items.length);
    if (nextIndex === null) return;
    event.preventDefault();
    selectIndex(nextIndex);
    virtualizer.scrollToIndex(nextIndex, { align: "auto" });
  };

  if (query.isPending) {
    return (
      <DashboardTableSkeleton
        gridTemplateColumns={gridTemplateColumns}
        renderHeader={renderHeader}
        rows={skeleton?.rows}
        rowHeight={skeleton?.rowHeight ?? estimateRowHeight}
        columnWidths={skeleton?.columnWidths}
        className={className}
      />
    );
  }
  if (query.isError) {
    return (
      <div className="py-8 text-center text-xs text-destructive">
        {errorState}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-muted-foreground">
        {emptyState}
      </div>
    );
  }

  return (
    <div
      ref={navigationContainerRef}
      aria-label="Keyboard navigable data table"
      className={cn(
        "rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <Table className="grid">
        <TableHeader className="grid">
          <TableRow
            className="grid [&_[data-slot=table-head]]:flex [&_[data-slot=table-head]]:items-center"
            style={{ gridTemplateColumns }}
          >
            {renderHeader()}
          </TableRow>
        </TableHeader>
        <TableBody
          ref={tableBodyRef}
          className="relative grid"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualRows.map((virtualRow) => {
            if (virtualRow.index >= items.length) {
              return (
                <TableRow
                  aria-hidden
                  className="absolute left-0 top-0 grid w-full items-center"
                  key="loader"
                  style={{
                    gridTemplateColumns,
                    height: virtualRow.size,
                    transform: `translateY(${
                      virtualRow.start - (scrollMargin ?? 0)
                    }px)`,
                  }}
                >
                  <SkeletonCells
                    columnWidths={
                      skeleton?.columnWidths ?? DEFAULT_SKELETON_WIDTHS
                    }
                  />
                </TableRow>
              );
            }

            const item = items[virtualRow.index] as TItem;
            const selected = virtualRow.index === activeIndex;
            return (
              <TableRow
                aria-selected={selected}
                className="absolute left-0 top-0 grid w-full cursor-default items-center data-[state=selected]:bg-muted/70"
                data-index={virtualRow.index}
                data-state={selected ? "selected" : undefined}
                key={getItemKey(item)}
                onClick={() => {
                  selectIndex(virtualRow.index);
                  navigationContainerRef.current?.focus({
                    preventScroll: true,
                  });
                }}
                onPointerEnter={() => trackIndex(virtualRow.index)}
                ref={virtualizer.measureElement}
                style={{
                  gridTemplateColumns,
                  minHeight: estimateRowHeight,
                  transform: `translateY(${
                    virtualRow.start - (scrollMargin ?? 0)
                  }px)`,
                }}
              >
                {renderRow(item, virtualRow.index)}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="sr-only">
        Focus the table and use J, K, or the arrow keys to move between rows.
      </p>
    </div>
  );
}
