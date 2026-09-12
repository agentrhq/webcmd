export default function ProgressBar({ percent = 0, label, tone = "rescue" }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));

  const barColor =
    tone === "ok" ? "bg-ok-500" : tone === "danger" ? "bg-danger-500" : "bg-rescue-500";

  return (
    <div>
      {label && (
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-navy-500">{label}</span>
          <span className="text-xs font-semibold text-navy-700">{value}%</span>
        </div>
      )}
      <div className="h-2 w-full rounded-full bg-navy-50 overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-500 ease-out`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
