const mongoose = require("mongoose");

const formFieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true }, // e.g. "name", "email", "sop"
    label: { type: String, required: true }, // e.g. "Full Name"
    value: { type: String, default: "" },
    filled: { type: Boolean, default: false },
    isDocument: { type: Boolean, default: false }, // true for Resume/Transcript/SOP style fields
  },
  { _id: false }
);

const webcmdLogEntrySchema = new mongoose.Schema(
  {
    step: { type: String, required: true },
    message: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const applicationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    opportunity: { type: mongoose.Schema.Types.ObjectId, ref: "Opportunity", required: true },
    status: {
      type: String,
      enum: [
        "Not Started",
        "Analyzing",
        "Missing Items",
        "Ready for Review",
        "Submitted",
      ],
      default: "Not Started",
    },
    matchPercent: { type: Number, default: 0 },
    formFields: [formFieldSchema],
    missingFields: [{ type: String }], // keys of fields still empty
    completionPercent: { type: Number, default: 0 },
    webcmdLog: [webcmdLogEntrySchema],
    submittedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Application", applicationSchema);
