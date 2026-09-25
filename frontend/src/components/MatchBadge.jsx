export default function MatchBadge({ percent }) {
  const value = Math.round(percent ?? 0);

  let tone = "bg-navy-50 text-navy-500 ring-navy-100";
  if (value >= 80) tone = "bg-ok-50 text-ok-700 ring-ok-300/50";
  else if (value >= 55) tone = "bg-rescue-50 text-rescue-700 ring-rescue-300/50";
  else tone = "bg-danger-50 text-danger-500 ring-danger-500/20";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${tone}`}
    >
      {value}% match
    </span>
  );
}
