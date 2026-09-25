require("dotenv").config();
const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const path = require("path");

const profileRoutes = require("./routes/profile");
const opportunityRoutes = require("./routes/opportunities");
const documentRoutes = require("./routes/documents");
const applicationRoutes = require("./routes/applications");

const app = express();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"))
);

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "application-rescue-agent-backend",
    webcmdMode: (process.env.WEBCMD_MODE || "DEMO").toUpperCase(),
    time: new Date().toISOString(),
  });
});

app.use("/api/profile", profileRoutes);
app.use("/api/opportunities", opportunityRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/applications", applicationRoutes);

// 404 fallback
app.use("/api", (req, res) => {
  res.status(404).json({ message: `No route for ${req.method} ${req.originalUrl}` });
});

// Basic error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Internal server error", detail: err.message });
});

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`[server] Application Rescue Agent API running on http://localhost:${PORT}`);
  });
});
