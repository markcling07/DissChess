import type { Issue } from "../chess/validate";

/** Problems with the position. Blocking ones appear first, marked with a fallen clock flag. */
export function IssueList({ issues }: { issues: readonly Issue[] }) {
  if (!issues.length) return null;
  const ordered = [...issues].sort((a, b) => Number(a.severity === "warning") - Number(b.severity === "warning"));
  return (
    <ul className="issues" aria-label="Problems with this position">
      {ordered.map((issue) => (
        <li key={`${issue.code}:${issue.message}`} className={`issue issue--${issue.severity}`}>
          {issue.message}
        </li>
      ))}
    </ul>
  );
}
