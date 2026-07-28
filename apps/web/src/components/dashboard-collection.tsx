import { cn } from "@versionless/ui/lib/utils";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export interface CollectionNavigationState {
  index: number;
  itemKey?: string;
}

const collectionNavigationMemory = new Map<
  string,
  CollectionNavigationState
>();
const STORAGE_PREFIX = "versionless:dashboard-collection:";
export const EVERY_ITEM_INTERACTIVE = () => true;

export function getNextCollectionIndex(
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
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  return null;
}

export function isCollectionActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

export function collectionStorageKey(navigationKey: string): string {
  return `${STORAGE_PREFIX}${navigationKey}`;
}

export function resolveCollectionIndex<TItem>(
  items: TItem[],
  state: CollectionNavigationState,
  getItemKey: (item: TItem, index: number) => string,
): number {
  if (items.length === 0) return 0;
  const keyedIndex = state.itemKey
    ? items.findIndex((item, index) => getItemKey(item, index) === state.itemKey)
    : -1;
  return keyedIndex >= 0 ? keyedIndex : Math.min(state.index, items.length - 1);
}

export function collectionStateAtIndex<TItem>(
  items: TItem[],
  index: number,
  getItemKey: (item: TItem, index: number) => string,
): CollectionNavigationState | null {
  const item = items[index];
  return item ? { index, itemKey: getItemKey(item, index) } : null;
}

export function readCollectionNavigationState(
  navigationKey: string,
): CollectionNavigationState {
  const remembered = collectionNavigationMemory.get(navigationKey);
  if (remembered) return remembered;
  if (typeof window === "undefined") return { index: 0 };

  try {
    const serialized = window.sessionStorage.getItem(
      collectionStorageKey(navigationKey),
    );
    return serialized
      ? (JSON.parse(serialized) as CollectionNavigationState)
      : { index: 0 };
  } catch {
    return { index: 0 };
  }
}

export function cacheCollectionNavigationState(
  navigationKey: string,
  state: CollectionNavigationState,
) {
  collectionNavigationMemory.set(navigationKey, state);
}

export function rememberCollectionNavigationState(
  navigationKey: string,
  state: CollectionNavigationState,
) {
  cacheCollectionNavigationState(navigationKey, state);
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      collectionStorageKey(navigationKey),
      JSON.stringify(state),
    );
  } catch {
    // Persistence is an enhancement. In-memory navigation remains available.
  }
}

export function DashboardCollectionStatus({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: "destructive" | "muted";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid min-h-32 place-items-center py-8 text-center text-xs",
        tone === "destructive" ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function useDashboardCollectionNavigation<TItem>({
  items,
  getItemKey,
  navigationKey,
  onItemActivate,
  isItemInteractive = EVERY_ITEM_INTERACTIVE,
}: {
  items: TItem[];
  getItemKey: (item: TItem, index: number) => string;
  navigationKey?: string;
  onItemActivate?: (item: TItem, index: number) => void;
  isItemInteractive?: (item: TItem, index: number) => boolean;
}) {
  const initialStateRef = useRef<{
    key?: string;
    state: CollectionNavigationState;
  } | null>(null);
  if (
    initialStateRef.current === null ||
    initialStateRef.current.key !== navigationKey
  ) {
    initialStateRef.current = {
      key: navigationKey,
      state: navigationKey
        ? readCollectionNavigationState(navigationKey)
        : { index: 0 },
    };
  }
  const [activeIndex, setActiveIndex] = useState(
    initialStateRef.current.state.index,
  );
  const getItemKeyRef = useRef(getItemKey);
  getItemKeyRef.current = getItemKey;

  useEffect(() => {
    const state = initialStateRef.current?.state ?? { index: 0 };
    setActiveIndex(
      resolveCollectionIndex(items, state, getItemKeyRef.current),
    );
  }, [items, navigationKey]);

  const trackIndex = (index: number, persist = false) => {
    const state = collectionStateAtIndex(items, index, getItemKey);
    if (!state) return;
    setActiveIndex(index);
    if (initialStateRef.current) initialStateRef.current.state = state;
    if (!navigationKey) return;
    if (persist) {
      rememberCollectionNavigationState(navigationKey, state);
    } else {
      cacheCollectionNavigationState(navigationKey, state);
    }
  };

  const activateIndex = (index: number) => {
    const item = items[index];
    if (
      item === undefined ||
      onItemActivate === undefined ||
      !isItemInteractive(item, index)
    ) {
      return;
    }
    trackIndex(index, true);
    onItemActivate(item, index);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.target !== event.currentTarget ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return;
    }
    if (isCollectionActivationKey(event.key)) {
      event.preventDefault();
      activateIndex(activeIndex);
      return;
    }
    const nextIndex = getNextCollectionIndex(
      event.key,
      activeIndex,
      items.length,
    );
    if (nextIndex === null) return;
    event.preventDefault();
    trackIndex(nextIndex, true);
  };

  return {
    activeIndex,
    activateIndex,
    handleKeyDown,
    trackIndex,
  };
}
