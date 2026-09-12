import { useNavigate } from "react-router-dom";
import { CalendarClock, MapPin, Coins } from "lucide-react";
import MatchBadge from "./MatchBadge.jsx";

const TYPE_COLORS = {
  Internship: "bg-navy-50 text-navy-700",
  Scholarship: "bg-ok-50 text-ok-700",
  Fellowship: "bg-rescue-50 text-rescue-700",
  Competition: "bg-warn-50 text-warn-500",
  Grant: "bg-navy-100 text-navy-700",
  "University Program": "bg-navy-50 text-navy-500",
};

function daysUntil(dateStr) {
  const diff = Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60 * 24));
  return diff;
}

export default function OpportunityCard({ opportunity }) {
  const navigate = useNavigate();
  const days = daysUntil(opportunity.deadline);
  const urgent = days <= 10;

  return (
    <button
      onClick={() => navigate(`/discover/${opportunity._id}`)}
      className="text-left rounded-xl2 bg-surface border border-navy-100 p-5 shadow-panel hover:border-navy-300 transition-colors w-full flex flex-col gap-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
              TYPE_COLORS[opportunity.type] || "bg-navy-50 text-navy-700"
            }`}
          >
            {opportunity.type}
          </span>
          <h3 className="mt-2 font-display font-semibold text-navy-900 leading-snug">
            {opportunity.title}
          </h3>
          <p className="text-sm text-navy-500">{opportunity.organization}</p>
        </div>
        {opportunity.matchPercent !== null && opportunity.matchPercent !== undefined && (
          <MatchBadge percent={opportunity.matchPercent} />
        )}
      </div>

      <p className="text-sm text-navy-700 line-clamp-2">{opportunity.description}</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-navy-500 mt-1">
        <span className={`flex items-center gap-1 ${urgent ? "text-rescue-700 font-semibold" : ""}`}>
          <CalendarClock className="h-3.5 w-3.5" />
          {days >= 0 ? `${days} day${days === 1 ? "" : "s"} left` : "Deadline passed"}
        </span>
        <span className="flex items-center gap-1">
          <MapPin className="h-3.5 w-3.5" />
          {opportunity.location}
        </span>
        {opportunity.stipendOrAmount && (
          <span className="flex items-center gap-1">
            <Coins className="h-3.5 w-3.5" />
            {opportunity.stipendOrAmount}
          </span>
        )}
      </div>
    </button>
  );
}
