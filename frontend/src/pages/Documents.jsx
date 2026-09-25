import { useEffect, useRef, useState } from "react";
import {
  FileText,
  GraduationCap,
  Award,
  PenLine,
  UploadCloud,
  CheckCircle2,
} from "lucide-react";

import api from "../api/api.js";
import { Panel, Loader } from "../components/Panel.jsx";
import StatusBadge from "../components/StatusBadge.jsx";

const ICONS = {
  Resume: FileText,
  Transcript: GraduationCap,
  Certificates: Award,
  SOP: PenLine,
};

const DESCRIPTIONS = {
  Resume:
    "Your latest resume or CV, used for internships, competitions, and grants.",

  Transcript:
    "Official academic transcript with your CGPA and grades.",

  Certificates:
    "Course, workshop, or achievement certificates that strengthen your application.",

  SOP:
    "A Statement of Purpose tailored to why you're a strong fit for an opportunity.",
};

export default function Documents() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadingType, setUploadingType] = useState(null);

  const fileInputRefs = useRef({});

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      setLoading(true);

      const data = await api.getDocuments();

      setDocuments(data);
    } catch (error) {
      console.error("Failed to load documents:", error);
    } finally {
      setLoading(false);
    }
  }


  function openFilePicker(type) {
    const input = fileInputRefs.current[type];

    if (input) {
      input.click();
    }
  }

  async function handleFileChange(type, event) {
    const file = event.target.files?.[0];

    // User cancelled file picker
    if (!file) {async function handleRemove(type) {
  const confirmed = window.confirm(
    `Remove your ${type}? You can upload it again later.`
  );

  if (!confirmed) return;

  try {
    setUploadingType(type);

    await api.removeDocument(type);

    await load();
  } catch (error) {
    console.error("Remove failed:", error);

    alert(
      error?.response?.data?.message ||
        "Could not remove the document."
    );
  } finally {
    setUploadingType(null);
  }
}
      return;
    }

    // Validate file type
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    const allowedExtensions = [".pdf", ".doc", ".docx"];

    const extension = file.name
      .substring(file.name.lastIndexOf("."))
      .toLowerCase();

    if (
      !allowedTypes.includes(file.type) &&
      !allowedExtensions.includes(extension)
    ) {
      alert("Please upload a PDF, DOC, or DOCX file.");
      event.target.value = "";
      return;
    }

    // 10 MB limit
    if (file.size > 10 * 1024 * 1024) {
      alert("File size must be less than 10 MB.");
      event.target.value = "";
      return;
    }

    try {
      setUploadingType(type);

      await api.uploadDocument(type, file);

      await load();
    } catch (error) {
      console.error("Upload failed:", error);

      alert(
        error?.response?.data?.message ||
          "File upload failed. Please try again."
      );
    } finally {
      setUploadingType(null);

      // Allows selecting the same file again
      event.target.value = "";
    }
  }

  if (loading) {
    return <Loader label="Loading your document vault..." />;
  }

  return (
    <div className="space-y-4 max-w-3xl">

      <Panel>
        <h3 className="font-display font-semibold text-navy-900">
          Document Vault
        </h3>

        <p className="text-sm text-navy-500 mt-1">
          Keep these up to date so the Rescue Agent can auto-fill
          applications instantly.
        </p>
      </Panel>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {documents.map((doc) => {
          const Icon = ICONS[doc.type] || FileText;

          const isMissing = doc.status === "missing";

          const isUploading =
            uploadingType === doc.type;

          return (
            <Panel
              key={doc._id}
              accent={
                isMissing
                  ? "border-l-danger-500"
                  : "border-l-ok-500"
              }
            >

              <div className="flex items-start gap-3">

                <div
                  className={`h-10 w-10 rounded-lg flex items-center justify-center ${
                    isMissing
                      ? "bg-danger-50 text-danger-500"
                      : "bg-ok-50 text-ok-700"
                  }`}
                >
                  <Icon className="h-5 w-5" />
                </div>

                <div className="flex-1 min-w-0">

                  <div className="flex items-center justify-between gap-2">

                    <p className="font-semibold text-navy-900">
                      {doc.type}
                    </p>

                    <StatusBadge status={doc.status} />

                  </div>

                  <p className="text-xs text-navy-500 mt-1">
                    {DESCRIPTIONS[doc.type]}
                  </p>

                  {doc.status === "uploaded" ? (
                    <div className="mt-2">

                      <p className="text-xs text-ok-700 flex items-center gap-1.5 truncate">
                        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />

                        <span className="truncate">
                          {doc.fileName}
                        </span>
                      </p>

<div className="flex items-center gap-2 mt-3">

  <button
    type="button"
    onClick={() => openFilePicker(doc.type)}
    disabled={isUploading}
    className="inline-flex items-center gap-2 rounded-lg bg-navy-900 text-white text-xs font-semibold px-3 py-2 hover:bg-navy-700 disabled:opacity-60 transition-colors"
  >
    <UploadCloud className="h-3.5 w-3.5" />

    {isUploading
      ? "Processing..."
      : `Replace ${doc.type}`}
  </button>

  <button
    type="button"
    onClick={() => handleRemove(doc.type)}
    disabled={isUploading}
    className="inline-flex items-center gap-2 rounded-lg border border-danger-200 text-danger-600 text-xs font-semibold px-3 py-2 hover:bg-danger-50 disabled:opacity-60 transition-colors"
  >
    Remove
  </button>

</div>

                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openFilePicker(doc.type)}
                      disabled={isUploading}
                      className="mt-3 inline-flex items-center gap-2 rounded-lg bg-navy-900 text-white text-xs font-semibold px-3 py-2 hover:bg-navy-700 disabled:opacity-60 transition-colors"
                    >
                      <UploadCloud className="h-3.5 w-3.5" />

                      {isUploading
                        ? "Uploading..."
                        : `Upload ${doc.type}`}
                    </button>
                  )}

                  {/* Hidden file input */}
                  <input
                    ref={(element) => {
                      fileInputRefs.current[doc.type] =
                        element;
                    }}
                    type="file"
                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    className="hidden"
                    onChange={(event) =>
                      handleFileChange(
                        doc.type,
                        event
                      )
                    }
                  />

                </div>
              </div>

            </Panel>
          );
        })}

      </div>

      <p className="text-xs text-navy-400">
        Supported formats: PDF, DOC, DOCX · Maximum size: 10 MB
      </p>

    </div>
  );
}