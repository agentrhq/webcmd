const Profile = require("../models/Profile");
const User = require("../models/User");

// This MVP has a single demo user, so "the current user" = the first User doc.
async function getDemoUser() {
  let user = await User.findOne();
  if (!user) {
    user = await User.create({ name: "Demo Student", email: "demo.student@vitbhopal.ac.in" });
  }
  return user;
}

exports.getProfile = async (req, res) => {
  try {
    const user = await getDemoUser();
    const profile = await Profile.findOne({ user: user._id });
    if (!profile) return res.status(404).json({ message: "Profile not found. Create one first." });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.upsertProfile = async (req, res) => {
  try {
    const user = await getDemoUser();
    const payload = { ...req.body, user: user._id };

    const profile = await Profile.findOneAndUpdate(
      { user: user._id },
      { $set: payload },
      { new: true, upsert: true, runValidators: true }
    );

    res.json(profile);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.getDemoUser = getDemoUser;
