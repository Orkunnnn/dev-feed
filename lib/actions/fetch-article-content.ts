"use server";

import https from "node:https";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import Parser from "rss-parser";
import sanitizeHtml from "sanitize-html";
import hljs from "highlight.js/lib/common";
import { feedSources } from "@/config/feeds";
import {
  decodeHtmlEntities,
  extractFeedAuthorName,
  extractReadTimeLabelFromContent,
} from "@/lib/utils";

export interface ArticleContent {
  title: string;
  content: string;
  siteName: string | null;
  excerpt: string | null;
  readingTimeLabel?: string;
  authorName?: string;
  authorAvatarUrl?: string;
  authors?: AuthorProfile[];
  contentMode: "full" | "summary";
}

export interface ArticleContentError {
  error: string;
}

export type FetchArticleResult = ArticleContent | ArticleContentError;

interface AuthorProfile {
  name: string;
  profileUrl: string;
  avatarUrl?: string;
}

type FeedItemWithEncoded = Parser.Item & {
  "content:encoded"?: string;
  "content:encodedSnippet"?: string;
};

interface FeedContentResolution {
  rawContent: string;
  excerpt: string | null;
  contentMode: "full" | "summary";
}

const agent = new https.Agent({ rejectUnauthorized: false });

const parser = new Parser({
  timeout: 10000,
  headers: {
    "User-Agent": "RSSDevFeed/1.0",
  },
  requestOptions: { agent },
});

type ParsedFeed = Parser.Output<FeedItemWithEncoded>;

interface TimedCacheEntry<T> {
  value: T;
  expiresAt: number;
}

const ARTICLE_RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
const ARTICLE_ERROR_CACHE_TTL_MS = 30 * 1000;
const ARTICLE_RESULT_CACHE_MAX_ENTRIES = 300;
const FEED_CACHE_TTL_MS = 5 * 60 * 1000;
const FEED_CACHE_MAX_ENTRIES = 20;

const articleResultCache = new Map<string, TimedCacheEntry<FetchArticleResult>>();
const articleResultInFlight = new Map<string, Promise<FetchArticleResult>>();

const feedCache = new Map<string, TimedCacheEntry<ParsedFeed>>();
const feedInFlight = new Map<string, Promise<ParsedFeed>>();

function getCachedValue<T>(
  cache: Map<string, TimedCacheEntry<T>>,
  key: string
): T | null {
  const cached = cache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return cached.value;
}

function setCachedValue<T>(
  cache: Map<string, TimedCacheEntry<T>>,
  key: string,
  value: T,
  ttlMs: number,
  maxEntries: number
): void {
  if (cache.has(key)) {
    cache.delete(key);
  }

  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });

  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) {
      break;
    }
    cache.delete(oldestKey);
  }
}

function normalizeHost(hostname: string): string {
  return hostname.replace(/^www\./, "").toLowerCase();
}

function normalizeComparableUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    url.hash = "";

    const cleanParams = [...url.searchParams.entries()]
      .filter(([key]) => {
        if (key.startsWith("utm_")) return false;
        return !["fbclid", "gclid", "ref", "source"].includes(key);
      })
      .sort(([a], [b]) => a.localeCompare(b));

    const params = new URLSearchParams(cleanParams);
    const query = params.toString();

    const pathname =
      url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");

    return `${url.origin}${pathname}${query ? `?${query}` : ""}`;
  } catch {
    return null;
  }
}

function toTrailingSlashUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    if (!url.pathname || url.pathname.endsWith("/")) {
      return null;
    }

    url.pathname = `${url.pathname}/`;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeArticleUrlForFetch(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const host = normalizeHost(url.hostname);
    const isOpenAiHost = host === "openai.com" || host.endsWith(".openai.com");
    const hasLikelyFileExtension = /\.[a-z0-9]{2,8}$/i.test(url.pathname);

    if (
      isOpenAiHost &&
      url.pathname.startsWith("/index/") &&
      !url.pathname.endsWith("/") &&
      !hasLikelyFileExtension
    ) {
      url.pathname = `${url.pathname}/`;
      return url.toString();
    }

    return rawUrl;
  } catch {
    return rawUrl;
  }
}

function getArticleCacheKey(url: string, sourceFeedUrl?: string): string {
  const normalizedArticleUrl = normalizeComparableUrl(url) || url;
  const feedKey = sourceFeedUrl ? normalizeComparableUrl(sourceFeedUrl) || sourceFeedUrl : "";
  return `${feedKey}::${normalizedArticleUrl}`;
}

async function fetchWithTrailingSlashRetry(
  url: string,
  init: RequestInit
): Promise<Response> {
  try {
    const response = await fetch(url, init);
    if (response.ok) {
      return response;
    }

    const trailingSlashUrl = toTrailingSlashUrl(url);
    if (!trailingSlashUrl) {
      return response;
    }

    try {
      const retried = await fetch(trailingSlashUrl, init);
      if (retried.ok) {
        return retried;
      }
    } catch {
      // Use initial response below.
    }

    return response;
  } catch (error) {
    const trailingSlashUrl = toTrailingSlashUrl(url);
    if (!trailingSlashUrl) {
      throw error;
    }

    return fetch(trailingSlashUrl, init);
  }
}

function normalizeAuthorName(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length > 120) return undefined;
  return normalized;
}

function normalizeBylineAuthorName(value: string | null | undefined): string | undefined {
  if (!value) return undefined;

  const lines = value
    .split(/\r?\n/)
    .map((line) => normalizeAuthorName(line))
    .filter((line): line is string => Boolean(line));

  if (lines.length > 1) {
    const firstLine = formatAuthorNameList(lines[0]);
    if (firstLine) {
      return firstLine;
    }
  }

  return formatAuthorNameList(normalizeAuthorName(value));
}

function formatAuthorNameList(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;

  if (normalized.includes(",")) {
    return normalized;
  }

  const withSplitBoundaries = normalized.replace(
    /(?<=[a-z])(?=[A-Z][a-z])/g,
    " "
  );

  const words = withSplitBoundaries.split(" ").filter(Boolean);
  const looksLikeTitleCaseWords = words.every((word) => /^[A-Z][\p{L}'-]*$/u.test(word));

  if (looksLikeTitleCaseWords && words.length >= 4 && words.length % 2 === 0) {
    const pairs: string[] = [];
    for (let i = 0; i < words.length; i += 2) {
      pairs.push(`${words[i]} ${words[i + 1]}`);
    }

    return pairs.join(", ");
  }

  return withSplitBoundaries;
}

function toAbsoluteUrl(url: string | null | undefined, baseUrl: string): string | undefined {
  if (!url) return undefined;

  try {
    const normalized = new URL(url, baseUrl).toString();
    if (!/^https?:\/\//i.test(normalized)) {
      return undefined;
    }

    return normalized;
  } catch {
    return undefined;
  }
}

function toAuthorNameKey(value: string | null | undefined): string | undefined {
  const normalized = normalizeAuthorName(value);
  if (!normalized) return undefined;
  return normalized.toLowerCase();
}

function setAuthorAvatar(
  map: Map<string, string>,
  name: string | null | undefined,
  avatarUrl: string | null | undefined,
  baseUrl: string
) {
  const key = toAuthorNameKey(name);
  const resolvedAvatarUrl = toAbsoluteUrl(avatarUrl, baseUrl);

  if (!key || !resolvedAvatarUrl || map.has(key)) {
    return;
  }

  map.set(key, resolvedAvatarUrl);
}

function mergeAuthorProfiles(
  first: AuthorProfile[] = [],
  second: AuthorProfile[] = []
): AuthorProfile[] {
  const merged: AuthorProfile[] = [];
  const seenIndexByUrl = new Map<string, number>();

  for (const author of [...first, ...second]) {
    const name = normalizeAuthorName(author.name);
    const profileUrl = toAbsoluteUrl(author.profileUrl, author.profileUrl);
    const avatarUrl = toAbsoluteUrl(author.avatarUrl, profileUrl || author.profileUrl);

    if (!name || !profileUrl) {
      continue;
    }

    const urlKey = profileUrl.toLowerCase();
    const existingIndex = seenIndexByUrl.get(urlKey);

    if (existingIndex !== undefined) {
      if (!merged[existingIndex].avatarUrl && avatarUrl) {
        merged[existingIndex].avatarUrl = avatarUrl;
      }
      continue;
    }

    seenIndexByUrl.set(urlKey, merged.length);
    merged.push({ name, profileUrl, avatarUrl });
  }

  return merged;
}

function extractAuthorLinks(
  nodes: Element[],
  baseUrl: string,
  avatarsByName: Map<string, string> = new Map()
): AuthorProfile[] {
  return nodes
    .map((node) => {
      const name = normalizeAuthorName(node.textContent || "");
      const profileUrl = toAbsoluteUrl(node.getAttribute("href"), baseUrl);

      if (!name || !profileUrl) {
        return null;
      }

      const avatarUrl = avatarsByName.get(name.toLowerCase());

      const authorProfile: AuthorProfile = {
        name,
        profileUrl,
      };

      if (avatarUrl) {
        authorProfile.avatarUrl = avatarUrl;
      }

      return authorProfile;
    })
    .filter((author): author is AuthorProfile => author !== null);
}

function extractAuthorInfoFromDocument(
  document: Document,
  baseUrl: string,
  byline?: string | null
): {
  authorName?: string;
  authorAvatarUrl?: string;
  authors?: AuthorProfile[];
} {
  const fromByline = normalizeBylineAuthorName(byline);

  const fromMeta = formatAuthorNameList(normalizeAuthorName(
    document
      .querySelector('meta[name="author"]')
      ?.getAttribute("content") ||
      document
        .querySelector('meta[property="article:author:name"]')
        ?.getAttribute("content")
  ));

  const cloudflareAvatarsByName = new Map<string, string>();
  for (const imageNode of Array.from(
    document.querySelectorAll(".author-lists img[alt][src]")
  )) {
    setAuthorAvatar(
      cloudflareAvatarsByName,
      imageNode.getAttribute("alt"),
      imageNode.getAttribute("src"),
      baseUrl
    );
  }

  const githubAvatarsByName = new Map<string, string>();
  for (const imageNode of Array.from(
    document.querySelectorAll("article.author-bio img[alt][src]")
  )) {
    setAuthorAvatar(
      githubAvatarsByName,
      imageNode.getAttribute("alt"),
      imageNode.getAttribute("src"),
      baseUrl
    );
  }

  const stripeAvatarsByName = new Map<string, string>();
  for (const authorNode of Array.from(document.querySelectorAll("figure.BlogAuthor"))) {
    const name =
      authorNode.querySelector("a.BlogAuthor__link")?.textContent ||
      authorNode.querySelector("figcaption a[href]")?.textContent ||
      "";
    const src = authorNode.querySelector("img.BlogAuthor__avatar")?.getAttribute("src");
    setAuthorAvatar(stripeAvatarsByName, name, src, baseUrl);
  }

  const cloudflareAuthorLinks = extractAuthorLinks(
    Array.from(document.querySelectorAll(".author-lists .author-name-tooltip a[href]")),
    baseUrl,
    cloudflareAvatarsByName
  );

  const stripeAuthorLinks = extractAuthorLinks(
    Array.from(document.querySelectorAll("a.BlogAuthor__link[href]")),
    baseUrl,
    stripeAvatarsByName
  );

  let githubAuthorLinks = extractAuthorLinks(
    Array.from(
      document.querySelectorAll(
        "div.mb-4.mb-lg-0 div.d-flex.flex-items-center.mb-6px a[rel='author'][href*='/author/'], div.mb-4.mb-lg-0 div.d-flex.flex-items-center.mb-6px a.author[href*='/author/']"
      )
    ),
    baseUrl,
    githubAvatarsByName
  );

  if (githubAuthorLinks.length === 0) {
    const firstGithubAuthorLink = document.querySelector(
      "a[rel='author'][href*='/author/'], a.author[href*='/author/']"
    );
    const bylineContainer = firstGithubAuthorLink?.closest(
      "div.d-flex.flex-items-center.mb-6px"
    );

    if (bylineContainer) {
      githubAuthorLinks = extractAuthorLinks(
        Array.from(
          bylineContainer.querySelectorAll(
            "a[rel='author'][href*='/author/'], a.author[href*='/author/']"
          )
        ),
        baseUrl,
        githubAvatarsByName
      );
    }
  }

  const linkedAuthors = mergeAuthorProfiles(
    mergeAuthorProfiles(cloudflareAuthorLinks, githubAuthorLinks),
    stripeAuthorLinks
  );
  const linkedAuthorNames = linkedAuthors.map((author) => author.name);

  if (linkedAuthorNames.length === 0) {
    const altNames = Array.from(document.querySelectorAll(".author-lists img[alt]"))
      .map((node) => normalizeAuthorName(node.getAttribute("alt") || ""))
      .filter((name): name is string => Boolean(name));

    linkedAuthorNames.push(...new Set(altNames));
  }

  const fromLinkedAuthorList =
    linkedAuthorNames.length > 0
      ? linkedAuthorNames.join(", ")
      : undefined;

  const authorName = formatAuthorNameList(
    fromLinkedAuthorList || fromByline || fromMeta
  );

  const linkedAuthorsAvatarUrl = linkedAuthors.find((author) => author.avatarUrl)?.avatarUrl;

  const avatarSrc =
    document
      .querySelector(".author-lists img.author-profile-image")
      ?.getAttribute("src") ||
    document
      .querySelector("article.author-bio img[src]")
      ?.getAttribute("src") ||
    document
      .querySelector("img.author-profile-image")
      ?.getAttribute("src") ||
    document
      .querySelector(".author-lists img[alt]")
      ?.getAttribute("src") ||
    document
      .querySelector("img.BlogAuthor__avatar[src]")
      ?.getAttribute("src") ||
    document
      .querySelector('[class*="author"] img[src]')
      ?.getAttribute("src") ||
    null;

  const bylinePrimaryAuthor = fromByline?.split(",")[0] || fromByline;
  const bylineAuthorKey = toAuthorNameKey(bylinePrimaryAuthor);
  const bylineAuthorAvatarUrl = bylineAuthorKey
    ? cloudflareAvatarsByName.get(bylineAuthorKey) ||
      githubAvatarsByName.get(bylineAuthorKey) ||
      stripeAvatarsByName.get(bylineAuthorKey)
    : undefined;

  const authorAvatarUrl =
    linkedAuthorsAvatarUrl || bylineAuthorAvatarUrl || toAbsoluteUrl(avatarSrc, baseUrl);

  return {
    authorName,
    authorAvatarUrl,
    authors: linkedAuthors.length > 0 ? linkedAuthors : undefined,
  };
}

function resolveFeedItemContent(item: FeedItemWithEncoded): FeedContentResolution {
  const encodedContent = item["content:encoded"]?.trim() || "";
  const contentField = item.content?.trim() || "";
  const summaryField = item.summary?.trim() || "";
  const snippetField = item.contentSnippet?.trim() || "";

  const rawContent =
    encodedContent ||
    contentField ||
    summaryField ||
    snippetField ||
    "";

  const excerptRaw = snippetField || summaryField || null;
  const excerpt = excerptRaw
    ? normalizeSpaces(decodeHtmlEntities(excerptRaw.replace(/<[^>]+>/g, " ")))
    : null;

  const contentMode: "full" | "summary" =
    encodedContent ||
    (contentField && !snippetField) ||
    (contentField && snippetField && contentField.length > snippetField.length + 200)
      ? "full"
      : "summary";

  return { rawContent, excerpt, contentMode };
}

function sanitizeArticleHtml(rawHtml: string): string {
  const sanitized = sanitizeHtml(rawHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "figure",
      "figcaption",
      "picture",
      "source",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "pre",
      "code",
      "blockquote",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "caption",
      "details",
      "summary",
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: [
        "src",
        "srcset",
        "sizes",
        "alt",
        "width",
        "height",
        "loading",
        "decoding",
        "fetchpriority",
      ],
      a: ["href", "title", "target", "rel"],
      source: ["src", "srcset", "sizes", "type", "media"],
      span: ["class"],
      code: ["class", "data-language", "data-lang"],
      pre: ["class", "data-language", "data-lang"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
    },
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          target: "_blank",
          rel: "noopener noreferrer",
        },
      }),
      img: (tagName, attribs) => {
        const src = attribs.src?.trim();
        const fallbackSrc =
          attribs["data-src"]?.trim() ||
          attribs["data-lazy-src"]?.trim() ||
          attribs["data-original"]?.trim();
        const normalizedSrc =
          src && !src.startsWith("data:image/") ? src : fallbackSrc || src;

        const srcSet = attribs.srcset?.trim();
        const fallbackSrcSet =
          attribs["data-srcset"]?.trim() || attribs["data-lazy-srcset"]?.trim();
        const normalizedSrcSet = srcSet || fallbackSrcSet;

        const sizes = attribs.sizes?.trim();

        const nextAttribs: Record<string, string> = {
          ...attribs,
          loading: "eager",
          decoding: "async",
          fetchpriority: "high",
        };

        if (normalizedSrc) {
          nextAttribs.src = normalizedSrc;
        }

        if (normalizedSrcSet) {
          nextAttribs.srcset = normalizedSrcSet;
          nextAttribs.sizes = sizes || "100vw";
        } else if (sizes) {
          nextAttribs.sizes = sizes;
        }

        return {
          tagName,
          attribs: nextAttribs,
        };
      },
    },
    exclusiveFilter: (frame) => {
      if (frame.tag !== "span") return false;

      const className = frame.attribs.class || "";
      return /\b(sr-only|screen-reader-text|visually-hidden|visuallyhidden|assistive-text|a11y-hidden|u-screen-reader-text|offscreen)\b/i.test(
        className
      );
    },
  });

  return sanitized.replace(/<\/a>(?=[\p{L}\p{N}])/gu, "</a> ");
}

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  sh: "bash",
  zsh: "bash",
  shell: "bash",
  yml: "yaml",
  md: "markdown",
  py: "python",
  rb: "ruby",
  rs: "rust",
  cs: "csharp",
  "c++": "cpp",
};

function resolveHighlightLanguage(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (hljs.getLanguage(normalized)) {
    return normalized;
  }

  const alias = LANGUAGE_ALIASES[normalized];
  if (alias && hljs.getLanguage(alias)) {
    return alias;
  }

  return null;
}

function getLanguageHints(element: Element | null): string[] {
  if (!element) {
    return [];
  }

  const classHints = (element.getAttribute("class") || "")
    .split(/\s+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => {
      const languageMatch = name.match(/^language-([a-z0-9_+\-#.]+)$/i);
      if (languageMatch) {
        return languageMatch[1];
      }

      const langMatch = name.match(/^lang-([a-z0-9_+\-#.]+)$/i);
      if (langMatch) {
        return langMatch[1];
      }

      return null;
    })
    .filter((value): value is string => Boolean(value));

  const dataHints = [
    element.getAttribute("data-language"),
    element.getAttribute("data-lang"),
  ].filter((value): value is string => Boolean(value && value.trim()));

  return [...dataHints, ...classHints];
}

function applySyntaxHighlightingToHtml(html: string): string {
  if (!html.includes("<pre") || !html.includes("<code")) {
    return html;
  }

  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const root = document.body;
  const codeBlocks = Array.from(root.querySelectorAll("pre > code"));

  for (const codeBlock of codeBlocks) {
    const code = codeBlock as Element;
    const pre = code.parentElement;
    const codeText = code.textContent || "";

    if (!codeText.trim()) {
      continue;
    }

    const hints = [...getLanguageHints(code), ...getLanguageHints(pre)];

    let resolvedLanguage: string | null = null;
    for (const hint of hints) {
      const language = resolveHighlightLanguage(hint);
      if (language) {
        resolvedLanguage = language;
        break;
      }
    }

    let highlightedHtml: string;
    let detectedLanguage: string | undefined;

    try {
      if (resolvedLanguage) {
        const highlighted = hljs.highlight(codeText, {
          language: resolvedLanguage,
          ignoreIllegals: true,
        });
        highlightedHtml = highlighted.value;
        detectedLanguage = resolvedLanguage;
      } else {
        const highlighted = hljs.highlightAuto(codeText);
        highlightedHtml = highlighted.value;
        detectedLanguage = highlighted.language;
      }
    } catch {
      continue;
    }

    code.innerHTML = highlightedHtml;

    const codeClasses = new Set(
      (code.getAttribute("class") || "")
        .split(/\s+/)
        .map((name) => name.trim())
        .filter(Boolean)
    );
    codeClasses.add("hljs");

    if (detectedLanguage) {
      codeClasses.add(`language-${detectedLanguage}`);
      code.setAttribute("data-language", detectedLanguage);
    }

    code.setAttribute("class", [...codeClasses].join(" "));

    if (pre) {
      const preClasses = new Set(
        (pre.getAttribute("class") || "")
          .split(/\s+/)
          .map((name) => name.trim())
          .filter(Boolean)
      );
      preClasses.add("hljs");
      pre.setAttribute("class", [...preClasses].join(" "));
    }
  }

  return root.innerHTML.trim();
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeForComparison(value: string): string {
  return normalizeSpaces(value)
    .toLowerCase()
    .replace(/["'`.,:;!?()[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const DATE_TEXT_PATTERN =
  /(?:\d{4}-\d{2}-\d{2}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/;

const READ_TIME_TEXT_PATTERN =
  /\d{1,3}\s*(?:min|mins|minute|minutes)\s*read/i;

function isLeadingMetadataText(value: string): boolean {
  const normalized = normalizeSpaces(value.replace(/[|\u00b7\u2022]/g, " "));
  if (!normalized || normalized.length > 48) {
    return false;
  }

  const datePattern = new RegExp(`^${DATE_TEXT_PATTERN.source}$`, "i");
  const readTimePattern = new RegExp(`^${READ_TIME_TEXT_PATTERN.source}$`, "i");
  const dateAndReadTimePattern = new RegExp(
    `^${DATE_TEXT_PATTERN.source}\\s+${READ_TIME_TEXT_PATTERN.source}$`,
    "i"
  );

  return (
    datePattern.test(normalized) ||
    readTimePattern.test(normalized) ||
    dateAndReadTimePattern.test(normalized)
  );
}

function isLeadingTitleText(value: string, title?: string): boolean {
  if (!title) return false;

  const normalizedValue = normalizeForComparison(value);
  const normalizedTitle = normalizeForComparison(title);

  if (!normalizedValue || !normalizedTitle) return false;
  if (normalizedValue === normalizedTitle) return true;

  return (
    normalizedValue.startsWith(normalizedTitle) ||
    normalizedTitle.startsWith(normalizedValue)
  );
}

function hasDirectText(element: Element): boolean {
  return Array.from(element.childNodes).some(
    (node) => node.nodeType === 3 && normalizeSpaces(node.textContent || "")
  );
}

function getFirstMeaningfulElement(root: Element): Element | null {
  const containerTags = new Set(["div", "section", "article", "main", "header"]);
  let current: Element = root;

  while (true) {
    let firstElement: Element | null = null;

    for (const node of Array.from(current.childNodes)) {
      if (node.nodeType === 3) {
        if (normalizeSpaces(node.textContent || "")) {
          return null;
        }
        continue;
      }

      if (node.nodeType === 1) {
        firstElement = node as Element;
        break;
      }
    }

    if (!firstElement) {
      return null;
    }

    const tag = firstElement.tagName.toLowerCase();
    if (containerTags.has(tag) && !hasDirectText(firstElement)) {
      current = firstElement;
      continue;
    }

    return firstElement;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLinkedInProfileUrl(urlValue: string): boolean {
  try {
    const url = new URL(urlValue);
    const hostname = normalizeHost(url.hostname);
    if (hostname !== "linkedin.com" && !hostname.endsWith(".linkedin.com")) {
      return false;
    }

    return url.pathname.startsWith("/in/") || url.pathname.startsWith("/pub/");
  } catch {
    return false;
  }
}

function normalizeAuthorLineText(value: string): string {
  return normalizeSpaces(
    decodeHtmlEntities(value)
      .replace(/\u00a0/g, " ")
      .replace(/^[,;:\s-]+|[,;:\s]+$/g, " ")
  );
}

function extractLeadingLinkedInAuthors(
  html: string,
  articleUrl?: string
): {
  authors: Array<{ name: string; profileUrl: string }>;
  content: string;
} {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const root = document.body;
  const firstElement = getFirstMeaningfulElement(root);

  if (!firstElement) {
    return { authors: [], content: root.innerHTML.trim() };
  }

  const linkedProfiles = Array.from(firstElement.querySelectorAll("a[href]"));
  if (linkedProfiles.length === 0 || linkedProfiles.length > 8) {
    return { authors: [], content: root.innerHTML.trim() };
  }

  const authors: Array<{ name: string; profileUrl: string }> = [];
  const seenUrls = new Set<string>();

  for (const profileLink of linkedProfiles) {
    const rawHref = profileLink.getAttribute("href") || "";
    let resolvedHref: string | null = null;
    try {
      resolvedHref = articleUrl
        ? new URL(rawHref, articleUrl).toString()
        : new URL(rawHref).toString();
    } catch {
      resolvedHref = null;
    }

    if (!resolvedHref || !isLinkedInProfileUrl(resolvedHref)) {
      continue;
    }

    const profileUrl = normalizeComparableUrl(resolvedHref) || resolvedHref;
    if (seenUrls.has(profileUrl)) {
      continue;
    }

    const name = normalizeAuthorLineText(profileLink.textContent || "");
    if (!name) {
      continue;
    }

    seenUrls.add(profileUrl);
    authors.push({ name, profileUrl });
  }

  if (authors.length === 0) {
    return { authors: [], content: root.innerHTML.trim() };
  }

  const firstLineText = normalizeAuthorLineText(firstElement.textContent || "");
  if (!firstLineText || firstLineText.length > 180 || /[.!?]/.test(firstLineText)) {
    return { authors: [], content: root.innerHTML.trim() };
  }

  let remainder = firstLineText;
  for (const author of authors) {
    remainder = remainder.replace(new RegExp(escapeRegExp(author.name), "gi"), " ");
  }

  remainder = normalizeSpaces(
    remainder
      .replace(/[\u00b7\u2022]/g, " ")
      .replace(/[,&/|]/g, " ")
      .replace(/\bby\b/gi, " ")
      .replace(/\band\b/gi, " ")
  );

  if (remainder) {
    return { authors: [], content: root.innerHTML.trim() };
  }

  firstElement.remove();
  return { authors, content: root.innerHTML.trim() };
}

function stripLeadingFeedMetadata(html: string, title?: string): string {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const root = document.body;

  for (let removed = 0; removed < 6; removed += 1) {
    const firstElement = getFirstMeaningfulElement(root);
    if (!firstElement) {
      break;
    }

    const firstText = normalizeSpaces(firstElement.textContent || "");
    const shouldRemove =
      isLeadingTitleText(firstText, title) || isLeadingMetadataText(firstText);

    if (!shouldRemove) {
      break;
    }

    firstElement.remove();
  }

  return root.innerHTML.trim();
}

function isOpenAiArticleUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = normalizeHost(url.hostname);
    return host === "openai.com" || host.endsWith(".openai.com");
  } catch {
    return false;
  }
}

function stripOpenAiTagSection(html: string, articleUrl: string): string {
  if (!isOpenAiArticleUrl(articleUrl)) {
    return html;
  }

  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const root = document.body;

  const headings = Array.from(root.querySelectorAll("h2, h3, h4, p, div"));
  for (const heading of headings) {
    const headingText = normalizeSpaces(heading.textContent || "").toLowerCase();
    if (headingText !== "tags" && headingText !== "topics") {
      continue;
    }

    const next = heading.nextElementSibling;
    heading.remove();

    if (next) {
      const nextText = normalizeSpaces(next.textContent || "");
      const nextLinks = next.querySelectorAll("a[href]").length;
      if (nextLinks > 0 && nextText.length < 260) {
        next.remove();
      }
    }
  }

  const candidates = Array.from(root.querySelectorAll("section, div, ul, ol"));
  for (const element of candidates) {
    const className = (element.getAttribute("class") || "").toLowerCase();
    const id = (element.getAttribute("id") || "").toLowerCase();
    const text = normalizeSpaces(element.textContent || "");
    const links = Array.from(element.querySelectorAll("a[href]"));

    if (!text || links.length === 0) {
      continue;
    }

    const hasTagMarker =
      /\b(tag|tags|topic|topics)\b/.test(className) ||
      /\b(tag|tags|topic|topics)\b/.test(id) ||
      /^(tags?|topics?)\b/i.test(text);

    const hasTagLikeLink = links.some((link) => {
      const href = link.getAttribute("href") || "";
      return /(^|\/)(tag|tags|topic|topics)(\/|$)/i.test(href);
    });

    if (!hasTagMarker && !hasTagLikeLink) {
      continue;
    }

    if (text.length <= 260 && links.length >= 1) {
      element.remove();
    }
  }

  return root.innerHTML.trim();
}

function toHtmlContent(content: string): string {
  const hasHtml = /<[^>]+>/.test(content);
  if (hasHtml) return content;

  const escaped = sanitizeHtml(content, {
    allowedTags: [],
    allowedAttributes: {},
  });

  return `<p>${escaped}</p>`;
}

function getFeedCandidates(articleUrl: string, sourceFeedUrl?: string): string[] {
  const candidates = new Set<string>();

  if (sourceFeedUrl) {
    candidates.add(sourceFeedUrl);
  }

  try {
    const articleHost = normalizeHost(new URL(articleUrl).hostname);

    for (const source of feedSources) {
      const sourceHost = normalizeHost(new URL(source.website).hostname);
      const sameDomain =
        articleHost === sourceHost ||
        articleHost.endsWith(`.${sourceHost}`) ||
        sourceHost.endsWith(`.${articleHost}`);

      if (sameDomain) {
        candidates.add(source.feedUrl);
      }
    }
  } catch {
    // no-op
  }

  return [...candidates];
}

async function parseFeedWithCache(feedUrl: string): Promise<ParsedFeed> {
  const cached = getCachedValue(feedCache, feedUrl);
  if (cached) {
    return cached;
  }

  const inFlight = feedInFlight.get(feedUrl);
  if (inFlight) {
    return inFlight;
  }

  const request = parser
    .parseURL(feedUrl)
    .then((feed) => {
      const parsed = feed as ParsedFeed;
      setCachedValue(feedCache, feedUrl, parsed, FEED_CACHE_TTL_MS, FEED_CACHE_MAX_ENTRIES);
      return parsed;
    })
    .finally(() => {
      feedInFlight.delete(feedUrl);
    });

  feedInFlight.set(feedUrl, request);
  return request;
}

async function getFallbackFromFeed(
  articleUrl: string,
  sourceFeedUrl?: string
): Promise<ArticleContent | null> {
  const target = normalizeComparableUrl(articleUrl);
  if (!target) return null;

  const candidates = getFeedCandidates(articleUrl, sourceFeedUrl);
  for (const feedUrl of candidates) {
    try {
      const feed = await parseFeedWithCache(feedUrl);
      const matchedItem = (feed.items as FeedItemWithEncoded[]).find((item) => {
        const linkCandidate = normalizeComparableUrl(item.link || "");
        if (linkCandidate === target) return true;

        const guidCandidate = normalizeComparableUrl(item.guid || "");
        return guidCandidate === target;
      });

      if (!matchedItem) continue;

      const { rawContent, excerpt, contentMode } =
        resolveFeedItemContent(matchedItem);

      if (!rawContent.trim()) continue;

      const sanitizedHtml = sanitizeArticleHtml(toHtmlContent(rawContent));
      const highlightedHtml = applySyntaxHighlightingToHtml(sanitizedHtml);
      const readingTimeLabel = extractReadTimeLabelFromContent(highlightedHtml);
      const { authors, content: contentWithoutAuthorLine } =
        extractLeadingLinkedInAuthors(highlightedHtml, articleUrl);
      const mergedAuthors = mergeAuthorProfiles(authors);
      const cleanHtml = stripLeadingFeedMetadata(
        contentWithoutAuthorLine,
        matchedItem.title?.trim() || undefined
      );
      const withoutTags = stripOpenAiTagSection(cleanHtml, articleUrl);
      if (!withoutTags.trim()) continue;

      const authorName = extractFeedAuthorName(
        matchedItem as unknown as Record<string, unknown>
      );
      const resolvedAuthorName =
        mergedAuthors.length > 0
          ? mergedAuthors.map((author) => author.name).join(", ")
          : authorName;

      return {
        title: matchedItem.title?.trim() || "",
        content: withoutTags,
        siteName: feed.title || null,
        excerpt,
        readingTimeLabel,
        authorName: resolvedAuthorName,
        authors: mergedAuthors.length > 0 ? mergedAuthors : undefined,
        contentMode,
      };
    } catch (error) {
      console.error(`Failed RSS fallback with feed ${feedUrl}:`, error);
    }
  }

  return null;
}

async function fetchArticleContentUncached(
  url: string,
  sourceFeedUrl?: string
): Promise<FetchArticleResult> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const fetchUrl = normalizeArticleUrlForFetch(url);

  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), 15000);

    const response = await fetchWithTrailingSlashRetry(fetchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; RSSDevFeed/1.0)",
        Accept: "text/html",
      },
    });

    if (!response.ok) {
      const fallback = await getFallbackFromFeed(url, sourceFeedUrl);
      if (fallback) return fallback;
      return { error: `Failed to fetch article (HTTP ${response.status})` };
    }

    const html = await response.text();

    const { document: authorDocument } = parseHTML(html);
    const { document: readabilityDocument } = parseHTML(html);

    const reader = new Readability(readabilityDocument as unknown as Document, {
      charThreshold: 100,
    });
    const article = reader.parse();

    const {
      authorName,
      authorAvatarUrl,
      authors: documentAuthors,
    } = extractAuthorInfoFromDocument(
      authorDocument as unknown as Document,
      response.url || url,
      article?.byline || null
    );

    if (!article || !article.content) {
      const fallback = await getFallbackFromFeed(url, sourceFeedUrl);
      if (fallback) return fallback;
      return { error: "Could not extract article content" };
    }

    const sanitizedHtml = sanitizeArticleHtml(article.content);
    const highlightedHtml = applySyntaxHighlightingToHtml(sanitizedHtml);
    const readingTimeLabel = extractReadTimeLabelFromContent(highlightedHtml);
    const { authors, content: contentWithoutAuthorLine } =
      extractLeadingLinkedInAuthors(highlightedHtml, response.url || url);
    const mergedAuthors = mergeAuthorProfiles(documentAuthors, authors);
    const resolvedAuthorName =
      mergedAuthors.length > 0
        ? mergedAuthors.map((author) => author.name).join(", ")
        : authorName;
    const cleanHtml = stripLeadingFeedMetadata(
      contentWithoutAuthorLine,
      article.title || undefined
    );
    const withoutTags = stripOpenAiTagSection(cleanHtml, response.url || url);

    return {
      title: article.title || "",
      content: withoutTags,
      siteName: article.siteName || null,
      excerpt: article.excerpt
        ? normalizeSpaces(decodeHtmlEntities(article.excerpt))
        : null,
      readingTimeLabel,
      authorName: resolvedAuthorName,
      authorAvatarUrl,
      authors: mergedAuthors.length > 0 ? mergedAuthors : undefined,
      contentMode: "full",
    };
  } catch (error) {
    const fallback = await getFallbackFromFeed(url, sourceFeedUrl);
    if (fallback) return fallback;

    if (error instanceof DOMException && error.name === "AbortError") {
      return { error: "Request timed out" };
    }

    console.error("Failed to fetch article content:", error);
    return { error: "An unexpected error occurred while fetching the article" };
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function fetchArticleContent(
  url: string,
  sourceFeedUrl?: string
): Promise<FetchArticleResult> {
  const cacheKey = getArticleCacheKey(url, sourceFeedUrl);
  const cached = getCachedValue(articleResultCache, cacheKey);
  if (cached) {
    return cached;
  }

  const inFlight = articleResultInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const request = fetchArticleContentUncached(url, sourceFeedUrl)
    .then((result) => {
      const ttl = "error" in result ? ARTICLE_ERROR_CACHE_TTL_MS : ARTICLE_RESULT_CACHE_TTL_MS;
      setCachedValue(
        articleResultCache,
        cacheKey,
        result,
        ttl,
        ARTICLE_RESULT_CACHE_MAX_ENTRIES
      );
      return result;
    })
    .finally(() => {
      articleResultInFlight.delete(cacheKey);
    });

  articleResultInFlight.set(cacheKey, request);
  return request;
}
