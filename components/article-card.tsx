import { useCallback, useEffect, useRef } from "react";
import type { Article } from "@/types/feed";
import { formatDate } from "@/lib/utils";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";

interface Props {
  article: Article;
  isRead?: boolean;
  onPrefetch?: () => void;
  onSelect: () => void;
}

interface QuoteBlock {
  text: string;
  owner?: string;
}

const HOVER_PREFETCH_DELAY_MS = 320;

function decodeBasicEntities(input: string): string {
  return input
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&ldquo;|&#8220;/gi, "\u201c")
    .replace(/&rdquo;|&#8221;/gi, "\u201d")
    .replace(/&mdash;|&#8212;/gi, "\u2014")
    .replace(/&ndash;|&#8211;/gi, "\u2013")
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

function getOwnerFromTail(tail: string): string | undefined {
  const normalized = tail.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;

  let candidate = normalized;
  const markerMatch = candidate.match(/^(?:[-\u2013\u2014]\s*|by\s+)(.+)$/i);
  if (markerMatch) {
    candidate = markerMatch[1].trim();
  }

  candidate = candidate.replace(/^[,;:\s]+/, "").trim();
  if (!candidate) return undefined;
  if (candidate.length > 90) return undefined;
  if (/[.!?]$/.test(candidate)) return undefined;
  if (!/[A-Za-z]/.test(candidate)) return undefined;
  if (candidate.split(/\s+/).length > 12) return undefined;

  return candidate;
}

function parseQuoteBlock(text: string): QuoteBlock | null {
  const normalized = decodeBasicEntities(text);
  const match = normalized.match(/^\s*["\u201c]([\s\S]+?)["\u201d](.*)$/);
  if (!match) return null;

  const quoteText = match[1].replace(/\s+/g, " ").trim();
  if (!quoteText || quoteText.length < 30) return null;

  const owner = getOwnerFromTail(match[2]);
  return { text: quoteText, owner };
}

export function ArticleCard({ article, isRead, onPrefetch, onSelect }: Props) {
  const quoteBlock = parseQuoteBlock(article.title) ?? parseQuoteBlock(article.excerpt);
  const isReadChecked = isRead === true;
  const hoverPrefetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoverPrefetchTimeout = useCallback(() => {
    if (hoverPrefetchTimeoutRef.current) {
      clearTimeout(hoverPrefetchTimeoutRef.current);
      hoverPrefetchTimeoutRef.current = null;
    }
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

  const handleMouseLeave = clearHoverPrefetchTimeout;

  const handleTouchStart = useCallback(() => {
    clearHoverPrefetchTimeout();
    onPrefetch?.();
  }, [clearHoverPrefetchTimeout, onPrefetch]);

  return (
    <Card
      className="cursor-pointer"
      onClick={onSelect}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <span aria-label={isReadChecked ? "Read" : "Unread"} className="inline-flex">
            <span
              className={`inline-flex size-4 items-center justify-center rounded-[3px] border ${
                isReadChecked
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/50"
              }`}
            >
              {isReadChecked ? <Check className="size-2.5" /> : null}
            </span>
          </span>
          <Badge variant="secondary">
            <time dateTime={article.publishedAt}>{formatDate(article.publishedAt)}</time>
          </Badge>
        </div>
        <span className="text-xs font-medium" style={{ color: article.sourceColor }}>
          {article.sourceName}
        </span>
        {quoteBlock ? (
          <div className="space-y-4">
            <CardTitle className="font-bold">
              <span className="block text-balance">{`"${quoteBlock.text}"`}</span>
            </CardTitle>
            {quoteBlock.owner && (
              <CardDescription>{quoteBlock.owner}</CardDescription>
            )}
          </div>
        ) : (
          <>
            <CardTitle className="font-bold">{article.title}</CardTitle>
            {article.excerpt && (
              <CardDescription
                style={{
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: 2,
                  overflow: "hidden",
                }}
              >
                {article.excerpt}
              </CardDescription>
            )}
          </>
        )}
      </CardHeader>
    </Card>
  );
}
