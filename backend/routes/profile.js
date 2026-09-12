const express = require("express");
const router = express.Router();
const profileController = require("../controllers/profileController");

router.get("/", profileController.getProfile);
router.post("/", profileController.upsertProfile);
router.put("/", profileController.upsertProfile);

module.exports = router;
