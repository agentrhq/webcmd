const Document = require("../models/Document");
const { getDemoUser } = require("./profileController");

const DOC_TYPES = ["Resume", "Transcript", "Certificates", "SOP"];

async function ensureVault(userId) {
  const existing = await Document.find({ user: userId });
  const existingTypes = new Set(existing.map((d) => d.type));

  const toCreate = DOC_TYPES
    .filter((type) => !existingTypes.has(type))
    .map((type) => ({
      user: userId,
      type,
      status: "missing",
      fileName: "",
      filePath: "",
    }));

  if (toCreate.length) {
    await Document.insertMany(toCreate);
  }

  return Document.find({ user: userId }).sort({ type: 1 });
}

exports.getDocuments = async (req, res) => {
  try {
    const user = await getDemoUser();
    const docs = await ensureVault(user._id);

    res.json(docs);
  } catch (err) {
    console.error("[documents] get error:", err);
    res.status(500).json({
      message: err.message,
    });
  }
};
exports.removeDocument = async (req, res) => {
  try {
    const { type } = req.params;

    const user = await getDemoUser();

    const doc = await Document.findOneAndUpdate(
      {
        user: user._id,
        type,
      },
      {
        $set: {
          status: "missing",
          fileName: "",
          filePath: "",
          uploadedAt: null,
        },
      },
      { new: true }
    );

    if (!doc) {
      return res.status(404).json({
        message: "Document not found.",
      });
    }

    res.json(doc);
  } catch (err) {
    console.error("[documents] remove error:", err);

    res.status(500).json({
      message: err.message,
    });
  }
};
exports.uploadDocument = async (req, res) => {
  try {
    const { type } = req.body;

    if (!DOC_TYPES.includes(type)) {
      return res.status(400).json({
        message: `type must be one of ${DOC_TYPES.join(", ")}`,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        message: "Please select a file to upload.",
      });
    }

    const user = await getDemoUser();

    const filePath = `/uploads/documents/${req.file.filename}`;

    const doc = await Document.findOneAndUpdate(
      {
        user: user._id,
        type,
      },
      {
        $set: {
          status: "uploaded",
          fileName: req.file.originalname,
          filePath,
          uploadedAt: new Date(),
        },
      },
      {
        new: true,
        upsert: true,
      }
    );

    console.log(
      `[documents] ${type} uploaded: ${req.file.originalname}`
    );

    res.json(doc);
  } catch (err) {
    console.error("[documents] upload error:", err);

    res.status(400).json({
      message: err.message,
    });
  }
};

exports.ensureVault = ensureVault;