const { discoverOpportunities } = require("../services/opportunityDiscoveryService");
const Opportunity = require("../models/Opportunity");
const Profile = require("../models/Profile");
const { computeMatchPercent } = require("../services/matchEngine");
const { getDemoUser } = require("./profileController");

exports.getAllOpportunities = async (req, res) => {
  try {
   const now = new Date();

const opportunities = await Opportunity.find({
  $or: [
    { deadline: null },
    { deadline: { $gte: now } }
  ]
}).sort({ deadline: 1 });

    let profile = null;
    try {
      const user = await getDemoUser();
      profile = await Profile.findOne({ user: user._id });
    } catch (e) {
      profile = null;
    }

    const withMatch = opportunities.map((opp) => ({
      ...opp.toObject(),
      matchPercent: profile ? computeMatchPercent(profile, opp) : null,
    }));

    res.json(withMatch);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getOpportunityById = async (req, res) => {
  try {
    const opp = await Opportunity.findById(req.params.id);
    if (!opp) return res.status(404).json({ message: "Opportunity not found" });

    let profile = null;
    const user = await getDemoUser();
    profile = await Profile.findOne({ user: user._id });

    res.json({
      ...opp.toObject(),
      matchPercent: profile ? computeMatchPercent(profile, opp) : null,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.discoverLiveOpportunities = async (req, res) => {
  try {
    console.log("[discovery] Starting live opportunity discovery...");

    const user = await getDemoUser();

    const profile = await Profile.findOne({
      user: user._id
    });

    if (!profile) {
      return res.status(400).json({
        message: "Student profile not found"
      });
    }

    const discovered = await discoverOpportunities(profile);

    const saved = [];

    for (const opportunity of discovered) {
      const existing = await Opportunity.findOne({
        applyUrl: opportunity.applyUrl
      });

      if (existing) {
        saved.push(existing);
        continue;
      }

      const created = await Opportunity.create(opportunity);
      saved.push(created);
    }

    const ranked = saved
      .map((opp) => ({
        ...opp.toObject(),
        matchPercent: computeMatchPercent(
          profile,
          opp
        )
      }))
      .sort(
        (a, b) =>
          b.matchPercent - a.matchPercent
      );

    console.log(
      `[discovery] ${ranked.length} opportunities ready`
    );

    res.json({
      success: true,
      count: ranked.length,
      opportunities: ranked
    });

  } catch (err) {
    console.error(
      "[discovery] Error:",
      err
    );

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

// Top recommended opportunities sorted by match %, highest first.
exports.getRecommended = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 6;
    const user = await getDemoUser();
    const profile = await Profile.findOne({ user: user._id });

    const now = new Date();

const opportunities = await Opportunity.find({
  $or: [
    { deadline: null },
    { deadline: { $gte: now } }
  ]
});

    const ranked = opportunities
      .map((opp) => ({
        ...opp.toObject(),
        matchPercent: profile ? computeMatchPercent(profile, opp) : 0,
      }))
      .sort((a, b) => b.matchPercent - a.matchPercent)
      .slice(0, limit);

    res.json(ranked);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
