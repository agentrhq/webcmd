const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    type: {
      type: String,
      enum: ["Resume", "Transcript", "Certificates", "SOP"],
      required: true,
    },

    fileName: {
      type: String,
      default: "",
    },

    filePath: {
      type: String,
      default: "",
    },

    status: {
      type: String,
      enum: ["uploaded", "missing"],
      default: "missing",
    },

    uploadedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

documentSchema.index({ user: 1, type: 1 }, { unique: true });

module.exports = mongoose.model("Document", documentSchema);