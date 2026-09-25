const Application = require("../models/Application");
const Opportunity = require("../models/Opportunity");
const Profile = require("../models/Profile");
const Document = require("../models/Document");
const { getDemoUser } = require("./profileController");
const { ensureVault } = require("./documentController");
const { computeMatchPercent } = require("../services/matchEngine");
const webcmdService = require("../services/webcmdService");

exports.getApplications = async (req, res) => {
  try {
    const user = await getDemoUser();
    const apps = await Application.find({ user: user._id })
      .populate("opportunity")
      .sort({ updatedAt: -1 });
    res.json(apps);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getApplicationById = async (req, res) => {
  try {
    const app = await Application.findById(req.params.id).populate("opportunity");
    if (!app) return res.status(404).json({ message: "Application not found" });
    res.json(app);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Start (or resume) a Rescue application for a given opportunity.
exports.startApplication = async (req, res) => {
  try {
    const { opportunityId } = req.body;
    const user = await getDemoUser();

    const opportunity = await Opportunity.findById(opportunityId);
    if (!opportunity) return res.status(404).json({ message: "Opportunity not found" });

    let app = await Application.findOne({ user: user._id, opportunity: opportunityId });

    if (!app) {
      const profile = await Profile.findOne({ user: user._id });
      const matchPercent = profile ? computeMatchPercent(profile, opportunity) : 0;

      app = await Application.create({
        user: user._id,
        opportunity: opportunityId,
        status: "Not Started",
        matchPercent,
        formFields: [],
        missingFields: [],
        completionPercent: 0,
        webcmdLog: [],
      });
    }

    const populated = await app.populate("opportunity");
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// The core "Rescue" step: Webcmd opens the form, auto-fills what it can
// from the profile + document vault, and flags what's missing.
exports.analyzeApplication = async (req, res) => {
  try {
    const app = await Application.findById(req.params.id).populate("opportunity");
    if (!app) return res.status(404).json({ message: "Application not found" });

    const user = await getDemoUser();
    const profile = await Profile.findOne({ user: user._id });
    const documents = await ensureVault(user._id);

    app.status = "Analyzing";
    await app.save();

    const result = await webcmdService.analyzeApplication({
      profile,
      documents,
      opportunity: app.opportunity,
    });

    app.formFields = result.formFields;
    app.missingFields = result.missingFields;
    app.completionPercent = result.completionPercent;
    app.status = result.status; // "Missing Items" or "Ready for Review"
    app.webcmdLog.push(...result.log);

    await app.save();

    const populated = await app.populate("opportunity");
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Explicit, user-triggered submission. Never happens automatically.
exports.submitApplication = async (req, res) => {
  try {
    const app = await Application.findById(req.params.id).populate("opportunity");
    if (!app) return res.status(404).json({ message: "Application not found" });

    if (app.status !== "Ready for Review") {
      return res.status(400).json({
        message:
          "This application still has missing items. Resolve them and re-run analysis before submitting.",
      });
    }

    app.status = "Submitted";
    app.submittedAt = new Date();
    app.webcmdLog.push({
      step: "submit",
      message: "User approved and submitted the application.",
      timestamp: new Date(),
    });

    await app.save();
    const populated = await app.populate("opportunity");
    res.json(populated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
