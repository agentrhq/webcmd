const mongoose = require("mongoose");

const profileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true },
    university: { type: String, default: "" },
    degree: { type: String, default: "" }, // e.g. B.Tech, B.Sc
    branch: { type: String, default: "" }, // e.g. Computer Science
    year: { type: Number, default: 1 }, // current year of study 1-5
    cgpa: { type: Number, default: 0 },
    skills: [{ type: String }],
    interests: [{ type: String }],
    experience: { type: String, default: "" }, // free text summary
    preferredTypes: [{ type: String }], // Internship, Scholarship, Fellowship, Competition, Grant, University Program
  },
  { timestamps: true }
);

module.exports = mongoose.model("Profile", profileSchema);
