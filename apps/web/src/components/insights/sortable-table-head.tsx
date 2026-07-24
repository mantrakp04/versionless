import { useState } from "react";
import { Button } from "@versionless/ui/components/button";
import { TableHead } from "@versionless/ui/components/table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { cn } from "@versionless/ui/lib/utils";

export type TableSortDirection = "asc" | "desc";

/**
 * Header-click sort state: clicking the active column flips the direction,
 * clicking a new column selects it and resets the direction (ascending unless
 * `resetDirection` says otherwise).
 */
export function useTableSort<Column extends string>(
  initialSort: Column,
  resetDirection: (column: Column) => TableSortDirection = () => "asc",
) {
  const [sort, setSort] = useState<Column>(initialSort);
  const [direction, setDirection] = useState<TableSortDirection>("desc");

  const toggleSort = (column: Column) => {
    if (column === sort) {
      setDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSort(column);
    setDirection(resetDirection(column));
  };

  return { sort, direction, toggleSort };
}

export function SortableTableHead<Column extends string>({
  label,
  column,
  sort,
  direction,
  onSort,
  align = "left",
}: {
  label: string;
  column: Column;
  sort: Column;
  direction: TableSortDirection;
  onSort: (column: Column) => void;
  align?: "left" | "right";
}) {
  const active = sort === column;
  const Icon = active
    ? direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;

  return (
    <TableHead
      className={align === "right" ? "text-right" : undefined}
      aria-sort={
        active ? (direction === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn("-mx-2", align === "right" && "ml-auto")}
        onClick={() => onSort(column)}
      >
        {label}
        <Icon className={active ? undefined : "opacity-40"} />
      </Button>
    </TableHead>
  );
}
