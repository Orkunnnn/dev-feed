# Agent Working Agreement

## Linting

- Run `pnpm lint` before finishing code changes.
- Do not leave lint warnings or errors behind.
- If a warning/error cannot be fixed safely in the current task, call it out explicitly with file and reason.

## Rendering Safety

- Do not use `dangerouslySetInnerHTML`.
- When converting HTML to React nodes, do not emit whitespace-only text nodes inside table structure tags (`table`, `thead`, `tbody`, `tfoot`, `tr`, `colgroup`) to avoid hydration errors.
- Preserve whitespace text nodes only where inline text flow requires it; prefer dropping structural whitespace.

## UI Constraints

- Do not modify any shadcn component unless the user explicitly asks for it.
- Do not add new CSS classes unless the user explicitly asks for styling changes.
- Color changes must work in both light and dark themes.
- Do not implement color changes for only a single theme.
