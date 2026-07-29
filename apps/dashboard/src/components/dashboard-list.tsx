import { ScrollArea } from "@versionless/ui/components/scroll-area";
import { Skeleton } from "@versionless/ui/components/skeleton";
import { cn } from "@versionless/ui/lib/utils";
import { useRef, type ReactNode } from "react";

import {
  DashboardCollectionStatus,
  EVERY_ITEM_INTERACTIVE,
  useDashboardCollectionNavigation,
} from "@/components/dashboard-collection";

export interface DashboardListSkeletonOptions {
  rows?: number;
  rowHeight?: number;
  contentClassName?: string;
  renderItem?: (index: number) => ReactNode;
}

export function DashboardListSkeleton({
  rows = 4,
  rowHeight = 58,
  contentClassName,
  renderItem,
  className,
}: DashboardListSkeletonOptions & { className?: string }) {
  return (
    <div
      aria-busy="true"
      aria-label="Loading list"
      className={cn("divide-y", contentClassName, className)}
      role="status"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          aria-hidden="true"
          className={cn(!renderItem && "flex items-center gap-3 py-3")}
          data-skeleton-item
          key={index}
          style={{ minHeight: rowHeight }}
        >
          {renderItem ? (
            renderItem(index)
          ) : (
            <>
              <Skeleton className="size-8 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2.5 w-2/5" />
              </div>
            </>
          )}
        </div>
      ))}
      <span className="sr-only">Loading list items</span>
    </div>
  );
}

export function DashboardList<TItem>({
  items,
  getItemKey,
  renderItem,
  navigationKey,
  selectedKey,
  onItemActivate,
  isItemInteractive = EVERY_ITEM_INTERACTIVE,
  getItemAriaLabel,
  isLoading = false,
  isError = false,
  skeleton,
  emptyState = "No results in this window.",
  errorState = "Unable to load results.",
  className,
  contentClassName,
  itemClassName,
  scrollAreaClassName,
}: {
  items: TItem[];
  getItemKey: (item: TItem, index: number) => string;
  renderItem: (item: TItem, index: number) => ReactNode;
  navigationKey?: string;
  selectedKey?: string | null;
  onItemActivate?: (item: TItem, index: number) => void;
  isItemInteractive?: (item: TItem, index: number) => boolean;
  getItemAriaLabel?: (item: TItem, index: number) => string;
  isLoading?: boolean;
  isError?: boolean;
  skeleton?: DashboardListSkeletonOptions;
  emptyState?: ReactNode;
  errorState?: ReactNode;
  className?: string;
  contentClassName?: string;
  itemClassName?: string | ((item: TItem, index: number) => string);
  scrollAreaClassName?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const interactive = onItemActivate !== undefined;
  const navigation = useDashboardCollectionNavigation({
    items,
    getItemKey,
    navigationKey,
    onItemActivate,
    isItemInteractive,
  });

  if (isLoading) {
    return <DashboardListSkeleton {...skeleton} className={className} />;
  }
  if (isError) {
    return (
      <DashboardCollectionStatus tone="destructive" className={className}>
        {errorState}
      </DashboardCollectionStatus>
    );
  }
  if (items.length === 0) {
    return (
      <DashboardCollectionStatus className={className}>
        {emptyState}
      </DashboardCollectionStatus>
    );
  }

  const content = (
    <div className={cn("divide-y", contentClassName)} role="list">
      {items.map((item, index) => {
        const key = getItemKey(item, index);
        const itemInteractive =
          interactive && isItemInteractive(item, index);
        const selected =
          selectedKey !== undefined
            ? key === selectedKey
            : index === navigation.activeIndex;
        const active = interactive && index === navigation.activeIndex;
        return (
          <div
            aria-label={
              itemInteractive ? getItemAriaLabel?.(item, index) : undefined
            }
            aria-selected={interactive ? selected : undefined}
            className={cn(
              "group outline-none transition-colors",
              itemInteractive && "cursor-pointer hover:bg-muted/50",
              interactive && "data-[active=true]:bg-muted/40",
              selectedKey !== undefined &&
                "data-[state=selected]:bg-muted/70",
              typeof itemClassName === "function"
                ? itemClassName(item, index)
                : itemClassName,
            )}
            data-active={active}
            data-item-key={key}
            data-state={selected ? "selected" : undefined}
            key={key}
            onClick={
              itemInteractive
                ? () => {
                    navigation.activateIndex(index);
                    containerRef.current?.focus({ preventScroll: true });
                  }
                : undefined
            }
            onPointerEnter={
              interactive ? () => navigation.trackIndex(index) : undefined
            }
            role="listitem"
          >
            {renderItem(item, index)}
          </div>
        );
      })}
    </div>
  );

  return (
    <div
      aria-label={interactive ? "Keyboard navigable data list" : undefined}
      className={cn(
        interactive &&
          "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      onKeyDown={interactive ? navigation.handleKeyDown : undefined}
      ref={containerRef}
      tabIndex={interactive ? 0 : undefined}
    >
      {scrollAreaClassName ? (
        <ScrollArea className={scrollAreaClassName}>{content}</ScrollArea>
      ) : (
        content
      )}
      {interactive ? (
        <p className="sr-only">
          Use J, K, Home, End, or the arrow keys to move. Press Enter or Space
          to open the active item.
        </p>
      ) : null}
    </div>
  );
}
