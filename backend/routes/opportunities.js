const express = require("express");

const router = express.Router();

const opportunityController = require("../controllers/opportunityController");

// Discover live opportunities from the web
router.post("/discover", opportunityController.discoverLiveOpportunities);

// Get recommended opportunities
router.get("/recommended", opportunityController.getRecommended);

// Get all opportunities
router.get("/", opportunityController.getAllOpportunities);

// Get opportunity by ID
router.get("/:id", opportunityController.getOpportunityById);

module.exports = router;