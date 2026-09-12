import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FolderClock, ArrowRight } from "lucide-react";
import api from "../api/api.js";
import { Panel, Loader, EmptyState } from "../components/Panel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import ProgressBar from "../components/ProgressBar.jsx";
import MatchBadge from "../components/MatchBadge.jsx";

export default function Applications() {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const data = await api.getApplications();
      setApplications(data);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <Loader label="Loading your applications..." />;

  if (applications.length === 0) {
    return (
      <Panel>
        <EmptyState
          icon={FolderClock}
          title="No applications yet"
          description="Head to Discover to find an opportunity and start a Rescue application."
          action={
            <Link to="/discover" className="inline-block rounded-lg bg-navy-900 text-white text-sm font-semibold px-4 py-2">
              Discover opportunities
            </Link>
          }
        />
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      {applications.map((app) => (
        <Link key={app._id} to={`/applications/${app._id}`}>
          <Panel className="hover:border-navy-300 transition-colors">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-display font-semibold text-navy-900">{app.opportunity?.title}</p>
                  <StatusBadge status={app.status} />
                </div>
                <p className="text-sm text-navy-500 mt-0.5">{app.opportunity?.organization}</p>
                <div className="mt-3 max-w-xs">
                  <ProgressBar
                    percent={app.completionPercent}
                    label="Form completion"
                    tone={app.completionPercent === 100 ? "ok" : "rescue"}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <MatchBadge percent={app.matchPercent} />
                <ArrowRight className="h-4 w-4 text-navy-500" />
              </div>
            </div>
          </Panel>
        </Link>
      ))}
    </div>
  );
}
