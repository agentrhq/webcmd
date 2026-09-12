export function Panel({ children, className = "", accent }) {
  const accentBorder = accent ? `border-l-4 ${accent}` : "border border-navy-100";
  return (
    <div className={`rounded-xl2 bg-surface ${accentBorder} shadow-panel p-5 ${className}`}>
      {children}
    </div>
  );
}

export function Loader({ label = "Loading..." }) {
  return (
    <div className="flex items-center gap-3 text-navy-500 text-sm py-8 justify-center">
      <span className="h-2 w-2 rounded-full bg-rescue-500 animate-rescue-pulse" />
      <span className="h-2 w-2 rounded-full bg-rescue-500 animate-rescue-pulse [animation-delay:0.2s]" />
      <span className="h-2 w-2 rounded-full bg-rescue-500 animate-rescue-pulse [animation-delay:0.4s]" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="text-center py-14 px-6">
      {Icon && (
        <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-navy-50 flex items-center justify-center">
          <Icon className="h-6 w-6 text-navy-500" />
        </div>
      )}
      <p className="font-display font-semibold text-navy-900">{title}</p>
      {description && <p className="text-sm text-navy-500 mt-1 max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
