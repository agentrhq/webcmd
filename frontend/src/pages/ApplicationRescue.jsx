import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  LifeBuoy,
  CheckCircle2,
  CircleAlert,
  UploadCloud,
  Send,
  Terminal,
} from "lucide-react";
import api from "../api/api.js";
import { Panel, Loader } from "../components/Panel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import ProgressBar from "../components/ProgressBar.jsx";

export default function ApplicationRescue() {
  const { id } = useParams();
  const [app, setApp] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploadingType, setUploadingType] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [visibleLogCount, setVisibleLogCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const data = await api.getApplication(id);
    setApp(data);
    setVisibleLogCount(data.webcmdLog?.length || 0);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAnalyze() {
    setAnalyzing(true);
    setSubmitError("");
    setVisibleLogCount(0);
    try {
      const updated = await api.analyzeApplication(id);
      setApp(updated);
      // Reveal the Webcmd log line by line for a "live agent" feel.
      const total = updated.webcmdLog.length;
      let i = 0;
      const interval = setInterval(() => {
        i += 1;
        setVisibleLogCount(i);
        if (i >= total) clearInterval(interval);
      }, 400);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleUploadMissingDoc(label) {
    setUploadingType(label);
    try {
      await api.uploadDocument(label, `${label.replace(/\s+/g, "_")}.pdf`);
      const updated = await api.analyzeApplication(id);
      setApp(updated);
      setVisibleLogCount(updated.webcmdLog.length);
    } finally {
      setUploadingType(null);
    }
  }

  async function handleSubmit() {
    const confirmed = window.confirm(
      "Submit this application now? This action cannot be undone from within the Rescue Agent."
    );
    if (!confirmed) return;

    setSubmitting(true);
    setSubmitError("");
    try {
      const updated = await api.submitApplication(id);
      setApp(updated);
    } catch (err) {
      setSubmitError(err?.response?.data?.message || "Could not submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Loader label="Opening the Rescue Agent..." />;
  if (!app) return <p className="text-navy-500">Application not found.</p>;

  const opp = app.opportunity;
  const hasRun = app.formFields && app.formFields.length > 0;
  const missingDocFields = (app.formFields || []).filter((f) => f.isDocument && !f.filled);
  const readyToSubmit = app.status === "Ready for Review";
  const submitted = app.status === "Submitted";

  return (
    <div className="max-w-3xl space-y-5">
      <Link
        to="/applications"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 hover:text-navy-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Applications
      </Link>

      <Panel accent="border-l-rescue-500">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-semibold text-rescue-700 uppercase tracking-wide">
              Application Rescue
            </p>
            <h2 className="text-xl font-display font-bold text-navy-900 mt-1">{opp?.title}</h2>
            <p className="text-sm text-navy-500">{opp?.organization}</p>
          </div>
          <StatusBadge status={app.status} />
        </div>

        <div className="mt-4">
          <ProgressBar
            percent={app.completionPercent}
            label="Form completion"
            tone={app.completionPercent === 100 ? "ok" : "rescue"}
          />
        </div>

        {!submitted && (
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-navy-900 text-white text-sm font-semibold px-5 py-2.5 hover:bg-navy-700 disabled:opacity-60 transition-colors"
          >
            <LifeBuoy className={`h-4 w-4 ${analyzing ? "animate-rescue-pulse" : ""}`} />
            {analyzing
              ? "Rescue Agent is working..."
              : hasRun
              ? "Re-run Rescue Agent"
              : "Run Rescue Agent"}
          </button>
        )}
      </Panel>

      {hasRun && (
        <Panel>
          <h3 className="font-display font-semibold text-navy-900 mb-3 flex items-center gap-2">
            <Terminal className="h-4 w-4 text-navy-500" />
            Webcmd activity log
          </h3>
          <ol className="space-y-2.5">
            {app.webcmdLog.slice(0, visibleLogCount).map((entry, idx) => (
              <li key={idx} className="flex gap-3 text-sm">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-rescue-500 flex-shrink-0" />
                <span className="text-navy-700">{entry.message}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      {hasRun && (
        <Panel>
          <h3 className="font-display font-semibold text-navy-900 mb-3">Form fields</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {app.formFields.map((field) => (
              <div
                key={field.key}
                className={`rounded-lg border px-3.5 py-3 ${
                  field.filled ? "border-ok-300/50 bg-ok-50" : "border-danger-500/30 bg-danger-50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-navy-700">{field.label}</p>
                  {field.filled ? (
                    <CheckCircle2 className="h-4 w-4 text-ok-700 flex-shrink-0" />
                  ) : (
                    <CircleAlert className="h-4 w-4 text-danger-500 flex-shrink-0" />
                  )}
                </div>
                <p className="text-sm text-navy-900 mt-1 truncate">
                  {field.filled ? field.value : "Missing"}
                </p>

                {!field.filled && field.isDocument && (
                  <button
                    onClick={() => handleUploadMissingDoc(field.label.split(" ")[0] === "Statement" ? "SOP" : field.label)}
                    disabled={uploadingType !== null}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-navy-900 text-white text-xs font-semibold px-2.5 py-1.5 hover:bg-navy-700 disabled:opacity-60 transition-colors"
                  >
                    <UploadCloud className="h-3.5 w-3.5" />
                    {uploadingType === field.label || uploadingType === "SOP" ? "Uploading..." : "Upload now"}
                  </button>
                )}
              </div>
            ))}
          </div>

          {missingDocFields.length === 0 && app.completionPercent < 100 && (
            <p className="text-xs text-navy-500 mt-3">
              Some fields still need attention - update your profile, then re-run the Rescue Agent.
            </p>
          )}
        </Panel>
      )}

      {hasRun && (
        <Panel accent={readyToSubmit ? "border-l-ok-500" : "border-l-navy-100"}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="font-display font-semibold text-navy-900">
                {submitted
                  ? "Application submitted"
                  : readyToSubmit
                  ? "Ready for your review"
                  : "Waiting on missing items"}
              </p>
              <p className="text-sm text-navy-500 mt-1">
                {submitted
                  ? `Submitted on ${new Date(app.submittedAt).toLocaleString()}.`
                  : readyToSubmit
                  ? "Everything is filled in. Review the fields above, then submit when you're ready."
                  : "Resolve the missing items above and re-run the Rescue Agent to unlock submission."}
              </p>
              {submitError && <p className="text-sm text-danger-500 mt-2">{submitError}</p>}
            </div>

            {!submitted && (
              <button
                onClick={handleSubmit}
                disabled={!readyToSubmit || submitting}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-ok-500 text-white text-sm font-semibold px-5 py-2.5 hover:bg-ok-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                <Send className="h-4 w-4" />
                {submitting ? "Submitting..." : "Approve & Submit"}
              </button>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
