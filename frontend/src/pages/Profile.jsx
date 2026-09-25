import { useEffect, useState } from "react";
import { Save, CheckCircle2 } from "lucide-react";
import api from "../api/api.js";
import { Panel, Loader } from "../components/Panel.jsx";

const OPPORTUNITY_TYPES = [
  "Internship",
  "Scholarship",
  "Fellowship",
  "Competition",
  "Grant",
  "University Program",
];

const emptyForm = {
  name: "",
  email: "",
  university: "",
  degree: "",
  branch: "",
  year: 1,
  cgpa: "",
  skills: "",
  interests: "",
  experience: "",
  preferredTypes: [],
};

export default function Profile() {
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const profile = await api.getProfile();
        setForm({
          ...profile,
          skills: (profile.skills || []).join(", "),
          interests: (profile.interests || []).join(", "),
        });
      } catch (e) {
        // No profile yet - keep the empty form
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function updateField(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  function toggleType(type) {
    setForm((f) => {
      const has = f.preferredTypes.includes(type);
      return {
        ...f,
        preferredTypes: has
          ? f.preferredTypes.filter((t) => t !== type)
          : [...f.preferredTypes, type],
      };
    });
    setSaved(false);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        year: Number(form.year) || 1,
        cgpa: Number(form.cgpa) || 0,
        skills: form.skills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        interests: form.interests
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      await api.saveProfile(payload);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loader label="Loading your profile..." />;

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-3xl">
      <Panel>
        <h3 className="font-display font-semibold text-navy-900 mb-4">Basic information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Full name" value={form.name} onChange={(v) => updateField("name", v)} required />
          <Field
            label="Email"
            type="email"
            value={form.email}
            onChange={(v) => updateField("email", v)}
            required
          />
          <Field
            label="University"
            value={form.university}
            onChange={(v) => updateField("university", v)}
          />
          <Field label="Degree" value={form.degree} onChange={(v) => updateField("degree", v)} />
          <Field label="Branch" value={form.branch} onChange={(v) => updateField("branch", v)} />
          <Field
            label="Year of study"
            type="number"
            min="1"
            max="5"
            value={form.year}
            onChange={(v) => updateField("year", v)}
          />
          <Field
            label="CGPA"
            type="number"
            step="0.01"
            min="0"
            max="10"
            value={form.cgpa}
            onChange={(v) => updateField("cgpa", v)}
          />
        </div>
      </Panel>

      <Panel>
        <h3 className="font-display font-semibold text-navy-900 mb-4">Skills & interests</h3>
        <div className="space-y-4">
          <Field
            label="Skills (comma separated)"
            value={form.skills}
            onChange={(v) => updateField("skills", v)}
            placeholder="e.g. JavaScript, React, Python, Machine Learning"
          />
          <Field
            label="Interests (comma separated)"
            value={form.interests}
            onChange={(v) => updateField("interests", v)}
            placeholder="e.g. Web Development, AI/ML, Research"
          />
          <div>
            <label className="block text-sm font-medium text-navy-700 mb-1.5">Experience summary</label>
            <textarea
              className="w-full rounded-lg border border-navy-100 px-3 py-2.5 text-sm text-navy-900 focus:outline-none focus:ring-2 focus:ring-rescue-300"
              rows={3}
              value={form.experience}
              onChange={(e) => updateField("experience", e.target.value)}
              placeholder="Briefly describe past projects, internships, or achievements"
            />
          </div>
        </div>
      </Panel>

      <Panel>
        <h3 className="font-display font-semibold text-navy-900 mb-4">Preferred opportunity types</h3>
        <div className="flex flex-wrap gap-2">
          {OPPORTUNITY_TYPES.map((type) => {
            const active = form.preferredTypes.includes(type);
            return (
              <button
                type="button"
                key={type}
                onClick={() => toggleType(type)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium border transition-colors ${
                  active
                    ? "bg-navy-900 text-white border-navy-900"
                    : "bg-surface text-navy-700 border-navy-100 hover:border-navy-300"
                }`}
              >
                {type}
              </button>
            );
          })}
        </div>
      </Panel>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-navy-900 text-white text-sm font-semibold px-5 py-2.5 hover:bg-navy-700 disabled:opacity-60 transition-colors"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : "Save profile"}
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ok-700">
            <CheckCircle2 className="h-4 w-4" />
            Saved
          </span>
        )}
      </div>
    </form>
  );
}

function Field({ label, value, onChange, type = "text", ...rest }) {
  return (
    <div>
      <label className="block text-sm font-medium text-navy-700 mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-navy-100 px-3 py-2.5 text-sm text-navy-900 focus:outline-none focus:ring-2 focus:ring-rescue-300"
        {...rest}
      />
    </div>
  );
}
