const express = require("express");
const router = express.Router();
const applicationController = require("../controllers/applicationController");

router.get("/", applicationController.getApplications);
router.post("/", applicationController.startApplication);
router.get("/:id", applicationController.getApplicationById);
router.post("/:id/analyze", applicationController.analyzeApplication);
router.post("/:id/submit", applicationController.submitApplication);

module.exports = router;
