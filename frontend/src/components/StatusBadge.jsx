const STYLES = {
  "Not Started": "bg-navy-50 text-navy-500 ring-navy-100",
  Analyzing: "bg-rescue-50 text-rescue-700 ring-rescue-300/50",
  "Missing Items": "bg-warn-50 text-warn-500 ring-warn-500/20",
  "Ready for Review": "bg-ok-50 text-ok-700 ring-ok-300/50",
  Submitted: "bg-navy-900 text-white ring-navy-900",
  uploaded: "bg-ok-50 text-ok-700 ring-ok-300/50",
  missing: "bg-danger-50 text-danger-500 ring-danger-500/20",
};

export default function StatusBadge({ status }) {
  const style = STYLES[status] || "bg-navy-50 text-navy-500 ring-navy-100";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${style}`}>
      {status}
    </span>
  );
}
