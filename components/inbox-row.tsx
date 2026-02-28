import { useCallback, useEffect, useRef } from "react";
import { Bookmark, BookmarkCheck, CheckCircle2, Circle, Trash2 } from "lucide-react";
import type { Article } from "@/types/feed";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  article: Article;
  isSelected: boolean;
  isRead: boolean;
  isSavedForLater: boolean;
  onSelect: () => void;
  onToggleRead: () => void;
  onToggleSavedForLater: () => void;
  onDelete: () => void;
  onPrefetch?: () => void;
}

const HOVER_PREFETCH_DELAY_MS = 280;

export function InboxRow({
  article,
  isSelected,
  isRead,
  isSavedForLater,
  onSelect,
  onToggleRead,
  onToggleSavedForLater,
  onDelete,
  onPrefetch,
}: Props) {
  const hoverPrefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoverPrefetchTimeout = useCallback(() => {
    if (!hoverPrefetchTimeoutRef.current) {
      return;
    }

    clearTimeout(hoverPrefetchTimeoutRef.current);
    hoverPrefetchTimeoutRef.current = null;
  }, []);

  useEffect(() => clearHoverPrefetchTimeout, [clearHoverPrefetchTimeout]);

  const handleMouseEnter = useCallback(() => {
    if (!onPrefetch) {
      return;
    }

    clearHoverPrefetchTimeout();
    hoverPrefetchTimeoutRef.current = setTimeout(() => {
      onPrefetch();
      hoverPrefetchTimeoutRef.current = null;
    }, HOVER_PREFETCH_DELAY_MS);
  }, [clearHoverPrefetchTimeout, onPrefetch]);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={clearHoverPrefetchTimeout}
      onTouchStart={onPrefetch}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        onSelect();
      }}
      className={cn(
        "group grid grid-cols-[auto_minmax(0,7.5rem)_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2.5 text-left transition-colors cursor-pointer sm:grid-cols-[auto_minmax(0,9rem)_minmax(0,1fr)_auto]",
        isSelected ? "bg-primary/10" : "bg-card hover:bg-muted/35"
      )}
      aria-label={`${isRead ? "Read" : "Unread"}: ${article.title}`}
    >
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={(event) => {
          event.stopPropagation();
          onToggleRead();
        }}
        aria-label={isRead ? "Mark as unread" : "Mark as read"}
      >
        {isRead ? <CheckCircle2 className="size-3.5" /> : <Circle className="size-3.5" />}
      </Button>

      <p
        className={cn(
          "truncate text-xs sm:text-sm",
          isRead ? "opacity-75" : "font-semibold"
        )}
        style={{ color: article.sourceColor }}
      >
        {article.sourceName}
      </p>

      <div className="min-w-0">
        <p className="truncate text-xs sm:text-sm">
          <span className={cn(!isRead && "font-semibold")}>{article.title}</span>
          {article.excerpt ? (
            <span className="text-muted-foreground">{` - ${article.excerpt}`}</span>
          ) : null}
        </p>
      </div>

      <div className="flex items-center justify-end">
        <div className="hidden items-center gap-1 group-hover:flex group-focus-within:flex">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={(event) => {
              event.stopPropagation();
              onToggleSavedForLater();
            }}
            aria-label={isSavedForLater ? "Remove bookmark" : "Add bookmark"}
          >
            {isSavedForLater ? (
              <BookmarkCheck className="size-3.5" />
            ) : (
              <Bookmark className="size-3.5" />
            )}
          </Button>
          <Button
            variant="destructive"
            size="icon-xs"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            aria-label="Delete article"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
        <time
          dateTime={article.publishedAt}
          className={cn(
            "w-20 text-right text-[11px] sm:text-xs group-hover:hidden group-focus-within:hidden",
            isRead ? "text-muted-foreground" : "text-foreground"
          )}
        >
          {formatDate(article.publishedAt)}
        </time>
      </div>
    </div>
  );
}
