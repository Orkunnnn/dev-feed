"use client";

import { Filter } from "lucide-react";
import type { FeedSource } from "@/config/feeds";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  sources: FeedSource[];
  uncheckedSourceIds: Set<string>;
  counts: Map<string, number>;
  onSetSourceChecked: (id: string, checked: boolean) => void;
  onCheckAll: () => void;
  onUncheckAll: () => void;
}

export function SourceFilter({
  sources,
  uncheckedSourceIds,
  counts,
  onSetSourceChecked,
  onCheckAll,
  onUncheckAll,
}: Props) {
  const visibleSources = sources.filter((source) => (counts.get(source.id) || 0) > 0);
  const hasVisibleSources = visibleSources.length > 0;
  const allChecked =
    hasVisibleSources && visibleSources.every((source) => !uncheckedSourceIds.has(source.id));
  const anyChecked = visibleSources.some((source) => !uncheckedSourceIds.has(source.id));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="default">
          <Filter className="size-3.5" />
          Filters
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>RSS Sources</DropdownMenuLabel>
        <DropdownMenuItem
          disabled={!hasVisibleSources || allChecked}
          onSelect={(event) => {
            event.preventDefault();
            onCheckAll();
          }}
        >
          Check all
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!anyChecked}
          onSelect={(event) => {
            event.preventDefault();
            onUncheckAll();
          }}
        >
          Uncheck all
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {visibleSources.map((source) => (
          <DropdownMenuCheckboxItem
            key={source.id}
            checked={!uncheckedSourceIds.has(source.id)}
            onSelect={(event) => {
              event.preventDefault();
            }}
            onCheckedChange={(checked) => {
              onSetSourceChecked(source.id, checked === true);
            }}
          >
            <span style={{ color: source.color }}>
              {source.name}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
