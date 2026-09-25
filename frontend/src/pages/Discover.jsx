import { useEffect, useMemo, useState } from "react";
import { Search, SlidersHorizontal, Globe } from "lucide-react";
import api from "../api/api.js";
import { Loader, EmptyState, Panel } from "../components/Panel.jsx";
import OpportunityCard from "../components/OpportunityCard.jsx";

const TYPES = [
  "All",
  "Internship",
  "Scholarship",
  "Fellowship",
  "Competition",
  "Grant",
  "University Program",
];

const SORTS = [
  { key: "match", label: "Best match" },
  { key: "deadline", label: "Deadline soonest" },
];

export default function Discover() {
  const [opportunities, setOpportunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All");
  const [sort, setSort] = useState("match");

  // Live discovery states
  const [discovering, setDiscovering] = useState(false);
  const [discoveryMessage, setDiscoveryMessage] = useState("");

  // Load existing opportunities
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);

        const data = await api.getOpportunities();

        setOpportunities(data);
      } catch (error) {
        console.error("Failed to load opportunities:", error);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  // Search the real web for new opportunities
  async function handleLiveDiscovery() {
    try {
      setDiscovering(true);
      setDiscoveryMessage("Searching the web for opportunities...");

      const data = await api.discoverOpportunities();

      if (data.opportunities) {
        setOpportunities(data.opportunities);
      }

      setDiscoveryMessage(
        `Found ${data.count || 0} live opportunities!`
      );
    } catch (error) {
      console.error("Live discovery error:", error);

      setDiscoveryMessage(
        "Could not find live opportunities. Please try again."
      );
    } finally {
      setDiscovering(false);
    }
  }

  // Filter and sort opportunities
  const filtered = useMemo(() => {
    let list = opportunities;

    // Filter by type
    if (type !== "All") {
      list = list.filter((o) => o.type === type);
    }

    // Search
    if (query.trim()) {
      const q = query.toLowerCase();

      list = list.filter(
        (o) =>
          (o.title || "").toLowerCase().includes(q) ||
          (o.organization || "").toLowerCase().includes(q) ||
          (o.requiredSkills || []).some((s) =>
            s.toLowerCase().includes(q)
          )
      );
    }

    // Sort
    list = [...list].sort((a, b) => {
      if (sort === "deadline") {
        // Put opportunities without a deadline at the end
        if (!a.deadline && !b.deadline) return 0;
        if (!a.deadline) return 1;
        if (!b.deadline) return -1;

        return new Date(a.deadline) - new Date(b.deadline);
      }

      return (b.matchPercent ?? 0) - (a.matchPercent ?? 0);
    });

    return list;
  }, [opportunities, query, type, sort]);

  return (
    <div className="space-y-5">
      <Panel>
        {/* Search + Sort */}
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 flex items-center gap-2 rounded-lg border border-navy-100 px-3 py-2.5">
            <Search className="h-4 w-4 text-navy-500" />

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title, organization, or skill..."
              className="w-full text-sm focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-navy-500 hidden sm:block" />

            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="rounded-lg border border-navy-100 px-3 py-2.5 text-sm text-navy-700 focus:outline-none focus:ring-2 focus:ring-rescue-300"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Live Web Discovery Button */}
        <div className="flex justify-end mt-3">
          <button
            onClick={handleLiveDiscovery}
            disabled={discovering}
            className="flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Globe className="h-4 w-4" />

            {discovering
              ? "Searching the web..."
              : "Find Live Opportunities"}
          </button>
        </div>

        {/* Discovery status */}
        {discoveryMessage && (
          <p className="mt-2 text-sm text-navy-600 text-right">
            {discoveryMessage}
          </p>
        )}

        {/* Opportunity Type Filters */}
        <div className="flex flex-wrap gap-2 mt-3">
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium border transition-colors ${
                type === t
                  ? "bg-navy-900 text-white border-navy-900"
                  : "bg-surface text-navy-700 border-navy-100 hover:border-navy-300"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </Panel>

      {/* Loading */}
      {loading ? (
        <Loader label="Finding opportunities..." />
      ) : filtered.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Search}
            title="No matching opportunities"
            description="Try a different search term or filter."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((opp) => (
            <div key={opp._id} className="relative">
              {/* LIVE badge */}
              {opp.sourceType === "live" && (
                <div className="absolute top-3 right-3 z-10">
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700 border border-green-200">
                    <Globe className="h-3 w-3" />
                    LIVE
                  </span>
                </div>
              )}

              <OpportunityCard opportunity={opp} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}