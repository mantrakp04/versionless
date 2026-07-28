import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
  type ReactNode,
} from "react";
import {
  useInfiniteQuery,
  type InfiniteData,
  type QueryKey,
  type UseInfiniteQueryOptions,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@versionless/ui/components/table";
import { Skeleton } from "@versionless/ui/components/skeleton";
import { cn } from "@versionless/ui/lib/utils";

import {
  cacheCollectionNavigationState,
  collectionStateAtIndex,
  collectionStorageKey,
  DashboardCollectionStatus,
  getNextCollectionIndex,
  isCollectionActivationKey,
  readCollectionNavigationState,
  rememberCollectionNavigationState,
  resolveCollectionIndex,
  useDashboardCollectionNavigation,
  type CollectionNavigationState,
} from "@/components/dashboard-collection";

type PageWithItems<TItem> = {
  items: TItem[];
};

const DEFAULT_SKELETON_WIDTHS = ["70%", "45%", "60%", "55%"] as const;
const EVERY_ROW_INTERACTIVE = () => true;

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
  gridTemplateColumns?: string;
  stickyHeader?: boolean;
}

interface DashboardTableProps<TItem> extends DashboardTableSharedProps<TItem> {
  items: TItem[];
  getItemKey: (item: TItem, index: number) => string;
  isLoading?: boolean;
  isError?: boolean;
  skeleton?: VirtualTableSkeletonOptions;
  navigationKey?: string;
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
  return getNextCollectionIndex(key, currentIndex, itemCount);
}

export function isRowActivationKey(key: string): boolean {
  return isCollectionActivationKey(key);
}

export function virtualTableStorageKey(navigationKey: string): string {
  return collectionStorageKey(navigationKey);
}

export function resolveRestoredIndex<TItem>(
  items: TItem[],
  state: CollectionNavigationState,
  getItemKey: (item: TItem) => string,
): number {
  return resolveCollectionIndex(items, state, getItemKey);
}

export function navigationStateAtIndex<TItem>(
  items: TItem[],
  index: number,
  getItemKey: (item: TItem) => string,
): CollectionNavigationState | null {
  return collectionStateAtIndex(items, index, getItemKey);
}

function SkeletonCells({ columnWidths }: { columnWidths: readonly string[] }) {
  return columnWidths.map((width, columnIndex) => (
    <TableCell aria-hidden="true" key={columnIndex}>
      <Skeleton className="h-3" style={{ width }} />
    </TableCell>
  ));
}

function DashboardTableShell({
  containerRef,
  renderHeader,
  gridTemplateColumns,
  stickyHeader = true,
  interactive = false,
  onKeyDown,
  children,
  className,
  busy,
  label,
  role,
}: {
  containerRef?: Ref<HTMLDivElement>;
  renderHeader: () => ReactNode;
  gridTemplateColumns?: string;
  stickyHeader?: boolean;
  interactive?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
  className?: string;
  busy?: boolean;
  label?: string;
  role?: "status";
}) {
  const grid = gridTemplateColumns !== undefined;
  return (
    <div
      ref={containerRef}
      aria-busy={busy}
      data-dashboard-sticky-table={stickyHeader ? "" : undefined}
      aria-label={
        label ?? (interactive ? "Keyboard navigable data table" : undefined)
      }
      className={cn(
        "rounded-md",
        interactive &&
          "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        stickyHeader && "[&_[data-slot=table-container]]:overflow-visible",
        className,
      )}
      onKeyDown={interactive ? onKeyDown : undefined}
      role={role}
      tabIndex={interactive ? 0 : undefined}
    >
      <Table className={grid ? "grid" : undefined}>
        <TableHeader
          className={cn(
            grid && "grid",
            stickyHeader &&
              "sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--border)]",
          )}
        >
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
        {children}
      </Table>
      {interactive ? (
        <p className="sr-only">
          Focus the table and use J, K, or the arrow keys to move between rows.
        </p>
      ) : null}
    </div>
  );
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
    <DashboardTableShell
      renderHeader={renderHeader}
      gridTemplateColumns={gridTemplateColumns}
      className={className}
      busy
      label="Loading table"
      role="status"
    >
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
    </DashboardTableShell>
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
  navigationKey,
  selectedKey,
  onRowActivate,
  isRowExpanded,
  renderExpandedRow,
  columnCount,
  expandedCellClassName,
  emptyState = "No results in this window.",
  errorState = "Unable to load results.",
  className,
  gridTemplateColumns,
  stickyHeader = true,
}: DashboardTableProps<TItem>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const interactive = onRowActivate !== undefined;
  const navigation = useDashboardCollectionNavigation({
    items,
    getItemKey,
    navigationKey,
    onItemActivate: onRowActivate,
  });

  if (isLoading) {
    return (
      <DashboardTableSkeleton
        gridTemplateColumns={gridTemplateColumns}
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
      <DashboardCollectionStatus tone="destructive">
        {errorState}
      </DashboardCollectionStatus>
    );
  }
  if (items.length === 0) {
    return (
      <DashboardCollectionStatus>{emptyState}</DashboardCollectionStatus>
    );
  }

  return (
    <DashboardTableShell
      containerRef={containerRef}
      renderHeader={renderHeader}
      gridTemplateColumns={gridTemplateColumns}
      stickyHeader={stickyHeader}
      interactive={interactive}
      onKeyDown={navigation.handleKeyDown}
      className={className}
    >
      <TableBody className={gridTemplateColumns ? "grid" : undefined}>
        {items.map((item, index) => {
          const key = getItemKey(item, index);
          const expanded = isRowExpanded?.(item, index) ?? false;
          return (
            <Fragment key={key}>
              <TableRow
                aria-expanded={renderExpandedRow ? expanded : undefined}
                aria-selected={interactive ? key === selectedKey : undefined}
                className={cn(
                  gridTemplateColumns && "grid items-center",
                  interactive && "cursor-pointer",
                )}
                data-row-key={key}
                data-state={key === selectedKey ? "selected" : undefined}
                onClick={
                  interactive
                    ? () => {
                        navigation.activateIndex(index);
                        containerRef.current?.focus({
                          preventScroll: true,
                        });
                      }
                    : undefined
                }
                onPointerEnter={
                  interactive
                    ? () => {
                        navigation.trackIndex(index);
                      }
                    : undefined
                }
                style={
                  gridTemplateColumns ? { gridTemplateColumns } : undefined
                }
              >
                {renderRow(item, index)}
              </TableRow>
              {expanded && renderExpandedRow ? (
                <TableRow
                  className={cn(
                    gridTemplateColumns && "grid",
                    "hover:bg-transparent",
                  )}
                  style={
                    gridTemplateColumns ? { gridTemplateColumns } : undefined
                  }
                >
                  <TableCell
                    className={expandedCellClassName}
                    colSpan={columnCount}
                    style={
                      gridTemplateColumns ? { gridColumn: "1 / -1" } : undefined
                    }
                  >
                    {renderExpandedRow(item, index)}
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          );
        })}
      </TableBody>
    </DashboardTableShell>
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
  onRowActivate,
  isRowInteractive = EVERY_ROW_INTERACTIVE,
  getRowAriaLabel,
  stickyHeader = true,
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
  onRowActivate?: (item: TItem, index: number) => void;
  isRowInteractive?: (item: TItem, index: number) => boolean;
  getRowAriaLabel?: (item: TItem, index: number) => string;
  stickyHeader?: boolean;
  emptyState?: ReactNode;
  errorState?: ReactNode;
  className?: string;
}) {
  const query = useInfiniteQuery(queryOptions);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);
  const navigationContainerRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState<number | null>(null);
  const navigationStateRef = useRef<{
    key: string;
    state: CollectionNavigationState;
  } | null>(null);
  if (
    navigationStateRef.current === null ||
    navigationStateRef.current.key !== navigationKey
  ) {
    navigationStateRef.current = {
      key: navigationKey,
      state: readCollectionNavigationState(navigationKey),
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
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollElement,
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
    const appScroller = tableBody.closest<HTMLElement>(
      '[data-slot="app-scroll-container"]',
    );
    if (!appScroller) return;
    setScrollElement(appScroller);

    const measureScrollMargin = () => {
      const nextScrollMargin =
        tableBody.getBoundingClientRect().top -
        appScroller.getBoundingClientRect().top +
        appScroller.scrollTop;
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
  const trackIndex = (index: number): CollectionNavigationState | null => {
    const state = navigationStateAtIndex(items, index, getItemKey);
    if (!state) return null;
    setActiveIndex(index);
    if (navigationStateRef.current) {
      navigationStateRef.current.state = state;
    }
    cacheCollectionNavigationState(navigationKey, state);
    return state;
  };

  const selectIndex = (index: number) => {
    const state = trackIndex(index);
    if (state) rememberCollectionNavigationState(navigationKey, state);
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
    if (isRowActivationKey(event.key)) {
      const item = items[activeIndex];
      if (
        item !== undefined &&
        onRowActivate &&
        isRowInteractive(item, activeIndex)
      ) {
        event.preventDefault();
        selectIndex(activeIndex);
        onRowActivate(item, activeIndex);
      }
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
      <DashboardCollectionStatus tone="destructive">
        {errorState}
      </DashboardCollectionStatus>
    );
  }
  if (items.length === 0) {
    return (
      <DashboardCollectionStatus>{emptyState}</DashboardCollectionStatus>
    );
  }

  return (
    <DashboardTableShell
      containerRef={navigationContainerRef}
      renderHeader={renderHeader}
      gridTemplateColumns={gridTemplateColumns}
      stickyHeader={stickyHeader}
      interactive
      onKeyDown={handleKeyDown}
      className={className}
    >
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
          const rowInteractive =
            onRowActivate !== undefined &&
            isRowInteractive(item, virtualRow.index);
          return (
            <TableRow
              aria-label={
                rowInteractive
                  ? getRowAriaLabel?.(item, virtualRow.index)
                  : undefined
              }
              aria-selected={selected}
              className={cn(
                "absolute left-0 top-0 grid w-full items-center data-[state=selected]:bg-muted/70",
                rowInteractive
                  ? "cursor-pointer hover:bg-muted/50"
                  : "cursor-default",
              )}
              data-index={virtualRow.index}
              data-state={selected ? "selected" : undefined}
              key={getItemKey(item)}
              onClick={() => {
                selectIndex(virtualRow.index);
                navigationContainerRef.current?.focus({
                  preventScroll: true,
                });
                if (rowInteractive) {
                  onRowActivate(item, virtualRow.index);
                }
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
    </DashboardTableShell>
  );
}
