import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  CalendarClock,
  MapPin,
  Coins,
  ArrowLeft,
  LifeBuoy,
  ListChecks,
} from "lucide-react";
import api from "../api/api.js";
import { Panel, Loader } from "../components/Panel.jsx";
import MatchBadge from "../components/MatchBadge.jsx";

export default function OpportunityDetails() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [opportunity, setOpportunity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const data = await api.getOpportunity(id);

      setOpportunity(data);
      setLoading(false);
    }

    load();
  }, [id]);

  async function handleStartRescue() {
    setStarting(true);

    try {
      const app = await api.startApplication(id);
      navigate(`/applications/${app._id}`);
    } finally {
      setStarting(false);
    }
  }

  // Safely format the deadline
  function formatDeadline(deadline) {
    // No deadline available
    if (!deadline) {
      return "Not specified";
    }

    const date = new Date(deadline);

    // Invalid date or Unix epoch date
    if (isNaN(date.getTime()) || date.getFullYear() <= 1970) {
      return "Not specified";
    }

    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  }

  if (loading) {
    return <Loader label="Loading opportunity..." />;
  }

  if (!opportunity) {
    return <p className="text-navy-500">Opportunity not found.</p>;
  }

  return (
    <div className="max-w-3xl space-y-5">
      <Link
        to="/discover"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 hover:text-navy-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Discover
      </Link>

      <Panel accent="border-l-navy-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <span className="inline-block rounded-full bg-navy-50 px-2.5 py-0.5 text-[11px] font-semibold text-navy-700">
              {opportunity.type}
            </span>

            <h2 className="mt-2 text-xl font-display font-bold text-navy-900">
              {opportunity.title}
            </h2>

            <p className="text-navy-500">
              {opportunity.organization}
            </p>
          </div>

          {opportunity.matchPercent !== null && (
            <MatchBadge percent={opportunity.matchPercent} />
          )}
        </div>

        <p className="text-sm text-navy-700 mt-4 leading-relaxed">
          {opportunity.description}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
          <InfoBlock
            icon={CalendarClock}
            label="Deadline"
            value={formatDeadline(opportunity.deadline)}
          />

          <InfoBlock
            icon={MapPin}
            label="Location"
            value={opportunity.location || "Remote"}
          />

          <InfoBlock
            icon={Coins}
            label="Reward"
            value={opportunity.stipendOrAmount || "Not specified"}
          />
        </div>
      </Panel>

      <Panel>
        <h3 className="font-display font-semibold text-navy-900 mb-3">
          Eligibility
        </h3>

        <p className="text-sm text-navy-700">
          {opportunity.eligibility || "Check official opportunity page"}
        </p>

        {opportunity.minCgpa > 0 && (
          <p className="text-sm text-navy-500 mt-2">
            Minimum CGPA required: {opportunity.minCgpa}
          </p>
        )}
      </Panel>

      <Panel>
        <h3 className="font-display font-semibold text-navy-900 mb-3 flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-navy-500" />
          Required documents
        </h3>

        <div className="flex flex-wrap gap-2">
          {opportunity.requiredDocuments?.map((doc) => (
            <span
              key={doc}
              className="rounded-full bg-navy-50 text-navy-700 text-xs font-medium px-3 py-1"
            >
              {doc}
            </span>
          ))}
        </div>
      </Panel>

      <Panel accent="border-l-rescue-500">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="font-display font-semibold text-navy-900">
              Ready to apply?
            </p>

            <p className="text-sm text-navy-500 mt-1">
              The Rescue Agent will open the form, auto-fill what it can from
              your profile, and flag anything missing before you submit.
            </p>
          </div>

          <button
            onClick={handleStartRescue}
            disabled={starting}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-rescue-500 text-white text-sm font-semibold px-5 py-2.5 hover:bg-rescue-700 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            <LifeBuoy className="h-4 w-4" />
            {starting ? "Starting..." : "Apply with Rescue Agent"}
          </button>
        </div>
      </Panel>
    </div>
  );
}

function InfoBlock({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg bg-navy-50 px-3.5 py-3">
      <p className="text-xs text-navy-500 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>

      <p className="text-sm font-semibold text-navy-900 mt-1">
        {value}
      </p>
    </div>
  );
}