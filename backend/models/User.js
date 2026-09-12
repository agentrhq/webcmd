const mongoose = require("mongoose");

// Simple demo user - no auth/password hashing since this is a hackathon MVP.
// The seed script creates one demo user and the frontend always operates as this user.
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
