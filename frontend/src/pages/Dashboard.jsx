import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, FileWarning, CalendarClock, ArrowRight } from "lucide-react";
import api from "../api/api.js";
import { Panel, Loader, EmptyState } from "../components/Panel.jsx";
import OpportunityCard from "../components/OpportunityCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

export default function Dashboard() {
  const [profile, setProfile] = useState(null);
  const [recommended, setRecommended] = useState([]);
  const [applications, setApplications] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const results = await Promise.allSettled([
        api.getProfile(),
        api.getRecommended(4),
        api.getApplications(),
        api.getDocuments(),
      ]);
      if (cancelled) return;

      if (results[0].status === "fulfilled") setProfile(results[0].value);
      if (results[1].status === "fulfilled") setRecommended(results[1].value);
      if (results[2].status === "fulfilled") setApplications(results[2].value);
      if (results[3].status === "fulfilled") setDocuments(results[3].value);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <Loader label="Loading your dashboard..." />;

  const missingDocs = documents.filter((d) => d.status === "missing");
  const inProgress = applications.filter(
    (a) => a.status === "Missing Items" || a.status === "Analyzing" || a.status === "Not Started"
  );
  const readyToSubmit = applications.filter((a) => a.status === "Ready for Review");

  return (
    <div className="space-y-6">
      {profile && (
        <Panel accent="border-l-navy-900">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-sm text-navy-500">Welcome back,</p>
              <h2 className="text-xl font-display font-bold text-navy-900">{profile.name}</h2>
              <p className="text-sm text-navy-500 mt-1">
                {profile.degree} in {profile.branch} · {profile.university}
              </p>
            </div>
            <Link
              to="/discover"
              className="inline-flex items-center gap-2 rounded-lg bg-navy-900 text-white text-sm font-semibold px-4 py-2.5 hover:bg-navy-700 transition-colors self-start"
            >
              <Sparkles className="h-4 w-4" />
              Find opportunities for me
            </Link>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          icon={Sparkles}
          label="Ready to submit"
          value={readyToSubmit.length}
          tone="ok"
          hint="Reviewed and complete"
        />
        <StatCard
          icon={CalendarClock}
          label="In progress"
          value={inProgress.length}
          tone="rescue"
          hint="Being rescued or filled"
        />
        <StatCard
          icon={FileWarning}
          label="Missing documents"
          value={missingDocs.length}
          tone="danger"
          hint={missingDocs.map((d) => d.type).join(", ") || "All documents uploaded"}
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold text-navy-900">Recommended for you</h3>
          <Link to="/discover" className="text-sm font-medium text-rescue-700 flex items-center gap-1">
            View all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {recommended.length === 0 ? (
          <Panel>
            <EmptyState
              icon={Sparkles}
              title="No recommendations yet"
              description="Complete your profile so the agent can match you with relevant opportunities."
              action={
                <Link
                  to="/profile"
                  className="inline-block rounded-lg bg-navy-900 text-white text-sm font-semibold px-4 py-2"
                >
                  Complete profile
                </Link>
              }
            />
          </Panel>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recommended.map((opp) => (
              <OpportunityCard key={opp._id} opportunity={opp} />
            ))}
          </div>
        )}
      </div>

      {applications.length > 0 && (
        <div>
          <h3 className="font-display font-semibold text-navy-900 mb-3">Recent applications</h3>
          <Panel className="!p-0 overflow-hidden">
            <ul className="divide-y divide-navy-100">
              {applications.slice(0, 5).map((app) => (
                <li key={app._id}>
                  <Link
                    to={`/applications/${app._id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-navy-50 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-navy-900 truncate">{app.opportunity?.title}</p>
                      <p className="text-xs text-navy-500">{app.opportunity?.organization}</p>
                    </div>
                    <StatusBadge status={app.status} />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone, hint }) {
  const toneClasses = {
    ok: "bg-ok-50 text-ok-700",
    rescue: "bg-rescue-50 text-rescue-700",
    danger: "bg-danger-50 text-danger-500",
  }[tone];

  return (
    <Panel>
      <div className="flex items-start gap-3">
        <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${toneClasses}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-2xl font-display font-bold text-navy-900 leading-none">{value}</p>
          <p className="text-sm font-medium text-navy-700 mt-1">{label}</p>
          <p className="text-xs text-navy-500 truncate mt-0.5">{hint}</p>
        </div>
      </div>
    </Panel>
  );
}
