export function EmptyState() {
  return (
    <div className="text-center py-16 text-muted-foreground">
      <p className="text-base">No articles match your filters</p>
      <p className="text-sm mt-1">Try selecting different sources</p>
    </div>
  );
}
