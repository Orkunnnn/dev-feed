const CUSTOM_FEED_COLORS = [
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f59e0b", // amber
  "#06b6d4", // cyan
  "#84cc16", // lime
  "#6366f1", // indigo
  "#14b8a6", // teal
  "#f97316", // orange
  "#a855f7", // purple
  "#3b82f6", // blue
  "#ef4444", // red
  "#22c55e", // green
];

export function getNextColor(usedColors: string[]): string {
  const available = CUSTOM_FEED_COLORS.filter((c) => !usedColors.includes(c));
  if (available.length > 0) return available[0];
  return CUSTOM_FEED_COLORS[usedColors.length % CUSTOM_FEED_COLORS.length];
}
