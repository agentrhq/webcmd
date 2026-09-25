const mongoose = require("mongoose");

const opportunitySchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
    },

    organization: {
      type: String,
      required: true,
    },

    type: {
      type: String,
      enum: [
        "Internship",
        "Scholarship",
        "Fellowship",
        "Competition",
        "Grant",
        "University Program",
      ],
      required: true,
    },

    description: {
      type: String,
      default: "",
    },

    // Optional because some live opportunities may not have
    // a clearly visible deadline.
    deadline: {
      type: Date,
      default: null,
    },

    eligibility: {
      type: String,
      default: "",
    },

    minCgpa: {
      type: Number,
      default: 0,
    },

    requiredSkills: [
      {
        type: String,
      },
    ],

    relatedInterests: [
      {
        type: String,
      },
    ],

    location: {
      type: String,
      default: "Remote",
    },

    stipendOrAmount: {
      type: String,
      default: "",
    },

    applyUrl: {
      type: String,
      default: "#",
    },

    requiredDocuments: [
      {
        type: String,
      },
    ],

    // Tells frontend whether this came from seed data
    // or from real web discovery.
    sourceType: {
      type: String,
      enum: ["demo", "live"],
      default: "demo",
    },

    // Original webpage where the opportunity was discovered.
    sourceUrl: {
      type: String,
      default: "",
    },

    // When Webcmd discovered this opportunity.
    discoveredAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Opportunity", opportunitySchema);