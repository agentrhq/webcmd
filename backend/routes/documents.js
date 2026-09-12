const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();
const documentController = require("../controllers/documentController");

// Create upload directory
const uploadDir = path.join(
  __dirname,
  "..",
  "uploads",
  "documents"
);

fs.mkdirSync(uploadDir, { recursive: true });

// Configure file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },

  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);

    const safeType = String(req.body.type || "document")
      .replace(/[^a-zA-Z0-9_-]/g, "_");

    const uniqueName =
      `${safeType}_${Date.now()}${ext}`;

    cb(null, uniqueName);
  },
});

// Allowed file types
const fileFilter = (req, file, cb) => {
  const allowed = [
    ".pdf",
    ".doc",
    ".docx",
  ];

  const ext = path.extname(file.originalname).toLowerCase();

  if (allowed.includes(ext)) {
    cb(null, true);
  } else {
    cb(
      new Error("Only PDF, DOC, and DOCX files are allowed."),
      false
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});


router.get(
  "/",
  documentController.getDocuments
);

router.post(
  "/upload",
  upload.single("file"),
  documentController.uploadDocument
);
router.delete(
  "/:type",
  documentController.removeDocument
);
module.exports = router;