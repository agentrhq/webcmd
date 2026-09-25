/**
 * webcmdService.js
 * ------------------------------------------------------------------
 * Integration layer for "Webcmd" - the CLI/tool used by the Rescue
 * Agent to open a target application form, read its fields, and
 * drive auto-fill. This module is intentionally the ONLY place that
 * knows about Webcmd, so swapping DEMO <-> REAL never touches the
 * rest of the codebase.
 *
 * Modes (set via WEBCMD_MODE in backend/.env):
 *   DEMO  - fully scripted, deterministic, no external process.
 *           Guarantees the hackathon demo works with zero flakiness.
 *   REAL  - shells out to the installed Webcmd CLI binary to open a
 *           real browser/page, read the DOM, and fill fields. If the
 *           binary isn't found or errors, we log it and gracefully
 *           fall back to DEMO logic so the flow never hard-crashes
 *           mid-demo.
 * ------------------------------------------------------------------
 */

const { execFile } = require("child_process");

const MODE = (process.env.WEBCMD_MODE || "DEMO").toUpperCase();
const WEBCMD_CLI_PATH = process.env.WEBCMD_CLI_PATH || "webcmd";

// The canonical demo application form. In DEMO mode this is what the
// Rescue Agent "opens" and reads fields from. Every field here maps to
// the Application Details form shown on the frontend (see DemoForm.jsx).
const DEMO_FORM_SCHEMA = [
  { key: "name", label: "Full Name", isDocument: false, source: "profile.name" },
  { key: "email", label: "Email", isDocument: false, source: "profile.email" },
  { key: "university", label: "University", isDocument: false, source: "profile.university" },
  { key: "degree", label: "Degree", isDocument: false, source: "profile.degree" },
  { key: "branch", label: "Branch", isDocument: false, source: "profile.branch" },
  { key: "skills", label: "Skills", isDocument: false, source: "profile.skills" },
  { key: "resume", label: "Resume", isDocument: true, source: "document.Resume" },
  { key: "transcript", label: "Transcript", isDocument: true, source: "document.Transcript" },
  { key: "sop", label: "Statement of Purpose (SOP)", isDocument: true, source: "document.SOP" },
];

function getFormSchema() {
  return DEMO_FORM_SCHEMA;
}

function resolveValue(source, profile, documentsByType) {
  if (source.startsWith("profile.")) {
    const field = source.split(".")[1];
    const val = profile ? profile[field] : null;
    if (Array.isArray(val)) return val.join(", ");
    return val || "";
  }
  if (source.startsWith("document.")) {
    const docType = source.split(".")[1];
    const doc = documentsByType[docType];
    if (doc && doc.status === "uploaded") return doc.fileName || `${docType}.pdf`;
    return "";
  }
  return "";
}

/**
 * Core DEMO-mode analysis. Deterministic, synchronous logic that
 * "fills what it safely can" from the student's profile + document
 * vault, and flags anything left empty as missing.
 */
function runDemoAnalysis({ profile, documents }) {
  const documentsByType = {};
  (documents || []).forEach((d) => {
    documentsByType[d.type] = d;
  });

  const log = [];
  log.push(step("open_form", "Webcmd opened the application form in DEMO mode."));
  log.push(step("read_fields", `Detected ${DEMO_FORM_SCHEMA.length} fields on the form.`));

  const formFields = DEMO_FORM_SCHEMA.map((field) => {
    const value = resolveValue(field.source, profile, documentsByType);
    const filled = Boolean(value);
    return {
      key: field.key,
      label: field.label,
      value,
      filled,
      isDocument: field.isDocument,
    };
  });

  const filledFields = formFields.filter((f) => f.filled).map((f) => f.label);
  const missingFields = formFields.filter((f) => !f.filled).map((f) => f.label);

  log.push(
    step(
      "autofill",
      filledFields.length
        ? `Auto-filled from profile & document vault: ${filledFields.join(", ")}.`
        : "No fields could be auto-filled yet."
    )
  );

  if (missingFields.length) {
    log.push(step("detect_missing", `Missing before submission: ${missingFields.join(", ")}.`));
  } else {
    log.push(step("detect_missing", "No missing fields or documents detected."));
  }

  const completionPercent = Math.round((filledFields.length / formFields.length) * 100);
  const status = missingFields.length === 0 ? "Ready for Review" : "Missing Items";

  log.push(step("complete", `Form completion is ${completionPercent}%. Status: ${status}.`));

  return { formFields, missingFields, completionPercent, status, log };
}

function step(name, message) {
  return { step: name, message, timestamp: new Date() };
}

/**
 * REAL mode: attempts to call the actual Webcmd CLI. Expected contract
 * (adjust to match your installed Webcmd CLI's real interface):
 *
 *   webcmd analyze --url <applyUrl> --profile <json> --json
 *
 * The CLI is expected to print a JSON object to stdout with the shape:
 *   { formFields: [...], missingFields: [...], completionPercent, status, log }
 *
 * If the CLI is missing, times out, or returns bad JSON, we log the
 * failure and fall back to DEMO analysis so the rescue flow still
 * completes for the user.
 */
function runRealAnalysis({ profile, documents, opportunity }) {
  return new Promise((resolve) => {
    const args = [
      "analyze",
      "--url",
      opportunity.applyUrl || "about:blank",
      "--profile",
      JSON.stringify(profile || {}),
      "--json",
    ];

    execFile(WEBCMD_CLI_PATH, args, { timeout: 15000 }, (error, stdout) => {
      if (error) {
        console.warn(`[webcmdService] REAL mode failed (${error.message}). Falling back to DEMO.`);
        const fallback = runDemoAnalysis({ profile, documents });
        fallback.log.unshift(
          step("real_mode_fallback", "Webcmd CLI unavailable/failed - fell back to DEMO analysis.")
        );
        return resolve(fallback);
      }

      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch (parseErr) {
        console.warn("[webcmdService] Could not parse Webcmd CLI output. Falling back to DEMO.");
        const fallback = runDemoAnalysis({ profile, documents });
        fallback.log.unshift(
          step("real_mode_fallback", "Webcmd CLI output was invalid JSON - fell back to DEMO analysis.")
        );
        resolve(fallback);
      }
    });
  });
}

/**
 * Public entry point used by the applications controller.
 * Always resolves - never throws - so a demo run never breaks mid-flow.
 */
async function analyzeApplication({ profile, documents, opportunity }) {
  if (MODE === "REAL") {
    return runRealAnalysis({ profile, documents, opportunity });
  }
  return runDemoAnalysis({ profile, documents });
}

module.exports = {
  MODE,
  getFormSchema,
  analyzeApplication,
};
