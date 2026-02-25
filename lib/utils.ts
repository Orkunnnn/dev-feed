import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

type RGB = [number, number, number]

function parseHexColor(value: string): RGB | null {
  const normalized = value.trim()

  if (/^#[\da-f]{3}$/i.test(normalized)) {
    const r = Number.parseInt(normalized[1] + normalized[1], 16)
    const g = Number.parseInt(normalized[2] + normalized[2], 16)
    const b = Number.parseInt(normalized[3] + normalized[3], 16)
    return [r, g, b]
  }

  if (/^#[\da-f]{6}$/i.test(normalized)) {
    const r = Number.parseInt(normalized.slice(1, 3), 16)
    const g = Number.parseInt(normalized.slice(3, 5), 16)
    const b = Number.parseInt(normalized.slice(5, 7), 16)
    return [r, g, b]
  }

  return null
}

function srgbToLinear(channel: number): number {
  const value = channel / 255
  if (value <= 0.04045) {
    return value / 12.92
  }

  return ((value + 0.055) / 1.055) ** 2.4
}

function luminance(rgb: RGB): number {
  const [r, g, b] = rgb
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

function contrastRatio(a: RGB, b: RGB): number {
  const l1 = luminance(a)
  const l2 = luminance(b)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

function mixRgb(from: RGB, to: RGB, amount: number): RGB {
  const clampedAmount = Math.max(0, Math.min(1, amount))
  return [
    Math.round(from[0] + (to[0] - from[0]) * clampedAmount),
    Math.round(from[1] + (to[1] - from[1]) * clampedAmount),
    Math.round(from[2] + (to[2] - from[2]) * clampedAmount),
  ]
}

function asRgbString(rgb: RGB): string {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`
}

export function getReadableBrandColor(baseColor: string, isDarkMode: boolean): string {
  const baseRgb = parseHexColor(baseColor)
  if (!baseRgb) {
    return baseColor
  }

  const background = isDarkMode ? ([23, 23, 26] as RGB) : ([255, 255, 255] as RGB)
  const minimumContrast = 4.5

  if (contrastRatio(baseRgb, background) >= minimumContrast) {
    return asRgbString(baseRgb)
  }

  const target = isDarkMode ? ([255, 255, 255] as RGB) : ([0, 0, 0] as RGB)
  let low = 0
  let high = 1
  let best = target

  for (let i = 0; i < 16; i += 1) {
    const mid = (low + high) / 2
    const candidate = mixRgb(baseRgb, target, mid)

    if (contrastRatio(candidate, background) >= minimumContrast) {
      best = candidate
      high = mid
    } else {
      low = mid
    }
  }

  return asRgbString(best)
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
}

function decodeCodePoint(value: string): string | null {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) {
    return null
  }

  try {
    return String.fromCodePoint(parsed)
  } catch {
    return null
  }
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);?/g, (match, decimalValue: string) => {
      const decoded = decodeCodePoint(decimalValue)
      return decoded ?? match
    })
    .replace(/&#x([\da-f]+);?/gi, (match, hexValue: string) => {
      const parsed = Number.parseInt(hexValue, 16)
      if (!Number.isFinite(parsed)) {
        return match
      }

      try {
        return String.fromCodePoint(parsed)
      } catch {
        return match
      }
    })
    .replace(/&([a-z][a-z\d]+);/gi, (match, entityName: string) => {
      return HTML_ENTITIES[entityName.toLowerCase()] ?? match
    })
    .replace(/\u00a0/g, " ")
}

export function formatDate(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return "";
  }
}

function getWordCount(content: string): number {
  const plainText = content
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();

  if (!plainText) return 0;

  return plainText.split(" ").filter(Boolean).length;
}

export function estimateReadingMinutes(
  content: string,
  wordsPerMinute = 220
): number {
  const words = getWordCount(content);

  if (words === 0) return 1;

  return Math.max(1, Math.ceil(words / wordsPerMinute));
}

export function formatReadingTime(minutes: number): string {
  return `${minutes} min read`;
}

export function estimateReadingTime(content: string): string {
  return formatReadingTime(estimateReadingMinutes(content));
}

export function extractReadTimeLabelFromContent(content: string): string | undefined {
  const plainText = content
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()

  const match = plainText.match(/\b(\d{1,3})\s*(?:min|mins|minute|minutes)\s*read\b/i)
  if (!match) {
    return undefined
  }

  const minutes = Number.parseInt(match[1], 10)
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) {
    return undefined
  }

  return formatReadingTime(minutes)
}

function normalizeReadTimeLabel(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const minutes = Math.round(value)
    if (minutes > 0 && minutes <= 240) {
      return formatReadingTime(minutes)
    }
    return undefined
  }

  if (typeof value !== "string") {
    return undefined
  }

  const match = value.trim().match(/\b(\d{1,3})\s*(?:min|mins|minute|minutes)\s*(?:read)?\b/i)
  if (!match) {
    return undefined
  }

  const minutes = Number.parseInt(match[1], 10)
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) {
    return undefined
  }

  return formatReadingTime(minutes)
}

function readTimeFromUnknown(value: unknown): string | undefined {
  const direct = normalizeReadTimeLabel(value)
  if (direct) return direct

  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = readTimeFromUnknown(item)
      if (parsed) return parsed
    }
    return undefined
  }

  if (!value || typeof value !== "object") {
    return undefined
  }

  const record = value as Record<string, unknown>
  for (const key of ["value", "text", "_", "#", "minutes", "duration"]) {
    if (key in record) {
      const parsed = readTimeFromUnknown(record[key])
      if (parsed) return parsed
    }
  }

  return undefined
}

export function extractFeedReadTimeLabel(item: Record<string, unknown>): string | undefined {
  const preferredKeys = [
    "readingTime",
    "reading_time",
    "readTime",
    "read_time",
    "timeToRead",
    "time_to_read",
    "minutesToRead",
    "minutes_to_read",
    "readDuration",
    "read_duration",
  ]

  for (const key of preferredKeys) {
    if (key in item) {
      const parsed = readTimeFromUnknown(item[key])
      if (parsed) return parsed
    }
  }

  const possibleReadTimeKey =
    /(?:read(ing)?[-_: ]?time|time[-_: ]?to[-_: ]?read|minutes?[-_: ]?to[-_: ]?read)/i

  for (const [key, value] of Object.entries(item)) {
    if (!possibleReadTimeKey.test(key)) {
      continue
    }

    const parsed = readTimeFromUnknown(value)
    if (parsed) return parsed
  }

  return undefined
}

function normalizeAuthorName(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized) return undefined
  if (normalized.length > 120) return undefined
  return normalized
}

function formatAuthorNameList(value: string | undefined): string | undefined {
  if (!value) return undefined

  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized) return undefined

  if (normalized.includes(",")) {
    return normalized
  }

  const withSplitBoundaries = normalized.replace(
    /(?<=[a-z])(?=[A-Z][a-z])/g,
    " "
  )

  const words = withSplitBoundaries.split(" ").filter(Boolean)
  const looksLikeTitleCaseWords = words.every((word) =>
    /^[A-Z][\p{L}'-]*$/u.test(word)
  )

  if (looksLikeTitleCaseWords && words.length >= 4 && words.length % 2 === 0) {
    const pairs: string[] = []
    for (let i = 0; i < words.length; i += 2) {
      pairs.push(`${words[i]} ${words[i + 1]}`)
    }

    return pairs.join(", ")
  }

  return withSplitBoundaries
}

function authorNameFromUnknown(value: unknown): string | undefined {
  if (typeof value === "string") {
    return formatAuthorNameList(normalizeAuthorName(value))
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = authorNameFromUnknown(item)
      if (parsed) return parsed
    }
    return undefined
  }

  if (!value || typeof value !== "object") {
    return undefined
  }

  const record = value as Record<string, unknown>
  for (const key of ["name", "displayName", "creator", "author", "value", "text", "_", "#"]) {
    if (key in record) {
      const parsed = authorNameFromUnknown(record[key])
      if (parsed) return parsed
    }
  }

  return undefined
}

export function extractFeedAuthorName(item: Record<string, unknown>): string | undefined {
  const preferredKeys = [
    "creator",
    "dc:creator",
    "author",
    "dc:author",
    "authors",
    "byline",
  ]

  for (const key of preferredKeys) {
    if (key in item) {
      const parsed = authorNameFromUnknown(item[key])
      if (parsed) return formatAuthorNameList(parsed)
    }
  }

  const possibleAuthorKey = /(?:author|creator|byline)/i

  for (const [key, value] of Object.entries(item)) {
    if (!possibleAuthorKey.test(key)) {
      continue
    }

    const parsed = authorNameFromUnknown(value)
    if (parsed) return formatAuthorNameList(parsed)
  }

  return undefined
}
