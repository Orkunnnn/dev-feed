"use client";

import { createElement, Fragment, type ReactNode, useMemo } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  html: string;
  className?: string;
  articleLink?: string;
  sourceId?: string;
}

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const ALLOWED_TAGS = new Set([
  "a",
  "article",
  "aside",
  "blockquote",
  "br",
  "caption",
  "code",
  "details",
  "div",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "main",
  "ol",
  "p",
  "picture",
  "pre",
  "section",
  "source",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "thead",
  "th",
  "tr",
  "u",
  "ul",
]);

const GLOBAL_ATTRIBUTES = new Set(["title"]);

const TAG_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href", "target", "rel"]),
  img: new Set(["src", "alt", "width", "height", "loading"]),
  source: new Set(["src", "srcset", "type", "media"]),
  code: new Set(["class"]),
  pre: new Set(["class"]),
  span: new Set(["class"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
};

const TABLE_STRUCTURE_TAGS = new Set([
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "colgroup",
]);

const INLINE_WHITESPACE_PARENTS = new Set([
  "a",
  "code",
  "em",
  "i",
  "span",
  "strong",
  "sub",
  "sup",
  "td",
  "th",
  "u",
]);

function isAllowedAttribute(tag: string, attrName: string): boolean {
  if (attrName === "style") return false;
  if (GLOBAL_ATTRIBUTES.has(attrName)) return true;
  if (attrName.startsWith("data-")) return true;
  if (attrName.startsWith("aria-")) return true;

  return TAG_ATTRIBUTES[tag]?.has(attrName) ?? false;
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?\s*>/gi, "\n\n")
    .replace(/<\/(p|div|section|article|h[1-6]|li|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function fallbackNodesFromHtml(html: string): ReactNode[] {
  const text = htmlToPlainText(html);
  if (!text) return [];

  return text.split(/\n\n+/).map((paragraph, index) => (
    <p key={`fallback-${index}`}>{paragraph.trim()}</p>
  ));
}

function normalizeQuoteOwnerText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[\u2013\u2014-]+\s*/, "")
    .replace(/^by\s+/i, "")
    .trim();
}

function looksLikeQuoteOwner(text: string): boolean {
  if (!text) return false;
  if (text.length < 3 || text.length > 140) return false;
  if (!/[A-Za-z]/.test(text)) return false;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 18) return false;

  if (/[.!?]$/.test(text) && !/[A-Z]\./.test(text)) {
    return false;
  }

  return text.includes(",") || words.some((word) => /^[A-Z][\p{L}'-]+$/u.test(word));
}

function moveQuoteOwnerInsideBlockquote(root: HTMLElement): void {
  const blockquotes = Array.from(root.querySelectorAll("blockquote"));

  for (const blockquote of blockquotes) {
    const next = blockquote.nextElementSibling as HTMLElement | null;
    if (!next) continue;

    const tag = next.tagName.toLowerCase();
    if (!["p", "div", "cite"].includes(tag)) continue;
    if (next.hasAttribute("data-quote-owner")) continue;

    if (
      next.querySelector(
        "blockquote, h1, h2, h3, h4, h5, h6, pre, table, ul, ol, figure"
      )
    ) {
      continue;
    }

    const ownerText = normalizeQuoteOwnerText(next.textContent || "");
    const quoteText = (blockquote.textContent || "").replace(/\s+/g, " ").trim();
    if (!looksLikeQuoteOwner(ownerText) || quoteText.length < 30) continue;

    if (!next.querySelector("a, strong, em, span, code")) {
      next.textContent = ownerText;
    }

    next.setAttribute("data-quote-owner", "true");
    blockquote.appendChild(next);
  }
}

function replaceWindowHintWithIcon(text: string, key: string): ReactNode {
  const markerPattern = /\(?\s*opens in a new window\s*\)?/i;
  const match = text.match(markerPattern);

  if (!match || match.index === undefined) {
    return text;
  }

  const start = match.index;
  const end = start + match[0].length;
  const before = text.slice(0, start).trimEnd();
  const after = text.slice(end).trimStart();

  return (
    <Fragment key={key}>
      {before}
      <ExternalLink
        size={14}
        aria-label="Opens in a new window"
        style={{ display: "inline-block", marginLeft: 4, verticalAlign: "text-bottom" }}
      />
      {after ? ` ${after}` : null}
    </Fragment>
  );
}

function getParentTagName(node: ChildNode): string | undefined {
  const parentElement =
    node.parentElement ||
    (node.parentNode && node.parentNode.nodeType === 1
      ? (node.parentNode as Element)
      : null);

  return parentElement?.tagName.toLowerCase();
}

function isWithinPreformattedContext(node: ChildNode): boolean {
  let current: Element | null =
    node.parentElement ||
    (node.parentNode && node.parentNode.nodeType === 1
      ? (node.parentNode as Element)
      : null);

  while (current) {
    const tag = current.tagName.toLowerCase();
    if (tag === "pre" || tag === "code") {
      return true;
    }

    current = current.parentElement;
  }

  return false;
}

function isDeployToCloudflareBadge(element: HTMLElement): boolean {
  if (element.tagName.toLowerCase() !== "img") {
    return false;
  }

  const alt = (element.getAttribute("alt") || "").toLowerCase();
  const src = (element.getAttribute("src") || "").toLowerCase();

  if (alt.includes("deploy to cloudflare")) {
    return true;
  }

  return src.includes("cloudflare") && src.includes("deploy");
}

function toReactNode(node: ChildNode, key: string): ReactNode {
  if (node.nodeType === 3) {
    const text = node.textContent || "";

    if (isWithinPreformattedContext(node)) {
      return text;
    }

    if (!text.trim()) {
      const parentTag = getParentTagName(node);
      if (!parentTag) return null;
      if (TABLE_STRUCTURE_TAGS.has(parentTag)) return null;
      if (INLINE_WHITESPACE_PARENTS.has(parentTag)) return " ";
      return null;
    }

    return replaceWindowHintWithIcon(text, key);
  }

  if (node.nodeType !== 1) {
    return null;
  }

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();

  if (tag === "script" || tag === "style") {
    return null;
  }

  if (!ALLOWED_TAGS.has(tag)) {
    const children = Array.from(element.childNodes).map((child, index) =>
      toReactNode(child, `${key}-${index}`)
    );

    return <Fragment key={key}>{children}</Fragment>;
  }

  if (tag === "br") {
    return (
      <Fragment key={key}>
        <br />
        <span className="line-break-spacer" aria-hidden="true" />
      </Fragment>
    );
  }

  const props: Record<string, unknown> = { key };

  for (const attr of Array.from(element.attributes)) {
    const attrName = attr.name.toLowerCase();

    if (!isAllowedAttribute(tag, attrName)) {
      continue;
    }

    if (attr.name === "class") {
      props.className = attr.value;
      continue;
    }

    if (attrName === "href") {
      if (!attr.value.trim()) {
        continue;
      }

      if (
        attr.value.startsWith("#") ||
        attr.value.startsWith("mailto:") ||
        attr.value.startsWith("tel:")
      ) {
        props.href = attr.value;
        continue;
      }

      props.href = attr.value;
      continue;
    }

    if (attrName === "src") {
      props.src = attr.value;
      continue;
    }

    const reactAttrName = attrName === "srcset" ? "srcSet" : attrName;
    props[reactAttrName] = attr.value;
  }

  if (isDeployToCloudflareBadge(element)) {
    props.style = {
      borderRadius: 0,
    };
  }

  if (VOID_TAGS.has(tag)) {
    return createElement(tag, props);
  }

  const children = Array.from(element.childNodes).map((child, index) =>
    toReactNode(child, `${key}-${index}`)
  );

  return createElement(tag, props, children);
}

export function ArticleContent({ html, className }: Props) {
  const contentNodes = useMemo(() => {
    if (!html.trim()) {
      return [];
    }

    if (typeof DOMParser === "undefined") {
      return fallbackNodesFromHtml(html);
    }

    try {
      const parser = new DOMParser();
      const document = parser.parseFromString(html, "text/html");
      const root = document.body;
      moveQuoteOwnerInsideBlockquote(root);

      const nodes = Array.from(root.childNodes).map((node, index) =>
        toReactNode(node, `content-${index}`)
      );

      const hasVisibleNodes = nodes.some((node) => {
        if (node === null || node === undefined || node === false) return false;
        if (typeof node === "string") return node.trim().length > 0;
        return true;
      });

      if (hasVisibleNodes) {
        return nodes;
      }
    } catch {
      // Fallback below
    }

    return fallbackNodesFromHtml(html);
  }, [html]);

  return (
    <div
      suppressHydrationWarning
      className={cn(
        "prose prose-base md:prose-lg dark:prose-invert max-w-none",
        "prose-headings:font-semibold prose-headings:tracking-tight",
        "prose-p:text-foreground prose-li:text-foreground prose-strong:text-foreground prose-em:text-foreground prose-blockquote:text-foreground",
        "prose-a:text-foreground prose-a:underline prose-a:underline-offset-2 prose-a:decoration-foreground/30 prose-a:transition-opacity prose-a:duration-200 prose-a:hover:opacity-80",
        "prose-img:rounded-md",
        "prose-table:my-6 prose-table:w-full prose-table:border-collapse prose-table:border prose-table:border-border/70 prose-table:bg-card prose-table:text-sm prose-table:shadow-sm",
        "prose-thead:bg-muted/70 prose-th:border prose-th:border-border/70 prose-th:px-4 prose-th:py-3 prose-th:text-left prose-th:font-semibold prose-th:text-foreground",
        "prose-tr:border-b prose-tr:border-border/50 prose-tr:last:border-b-0",
        "prose-td:border prose-td:border-border/60 prose-td:px-4 prose-td:py-3 prose-td:align-top prose-td:text-foreground/90",
        "[&_tbody_tr:nth-child(even)]:bg-muted/25",
        "max-sm:[&_table]:block max-sm:[&_table]:overflow-x-auto max-sm:[&_table]:whitespace-nowrap",
        "prose-pre:bg-muted prose-pre:text-foreground prose-pre:overflow-x-auto prose-pre:rounded-none prose-pre:p-4 prose-pre:text-sm prose-pre:leading-relaxed",
        "prose-pre:font-mono prose-code:font-mono prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none",
        "[&_span.line-break-spacer]:block [&_span.line-break-spacer]:h-4",
        "[&_blockquote_[data-quote-owner=true]]:mt-5 [&_blockquote_[data-quote-owner=true]]:text-center [&_blockquote_[data-quote-owner=true]]:text-sm [&_blockquote_[data-quote-owner=true]]:font-normal [&_blockquote_[data-quote-owner=true]]:not-italic [&_blockquote_[data-quote-owner=true]]:text-muted-foreground",
        className
      )}
    >
      {contentNodes}
    </div>
  );
}
