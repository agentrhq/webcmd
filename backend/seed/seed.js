require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");

const User = require("../models/User");
const Profile = require("../models/Profile");
const Opportunity = require("../models/Opportunity");
const Document = require("../models/Document");
const Application = require("../models/Application");

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

const opportunities = [
  {
    title: "Software Engineering Internship",
    organization: "Nimbus Cloud Systems",
    type: "Internship",
    description:
      "3-month backend internship working on distributed systems in Node.js and Go. Mentorship provided.",
    deadline: daysFromNow(9),
    eligibility: "B.Tech/B.E. students in 2nd year or above, CS/IT/related branches",
    minCgpa: 7.0,
    requiredSkills: ["JavaScript", "Node.js", "React", "MongoDB"],
    relatedInterests: ["Web Development", "Backend Systems"],
    location: "Remote",
    stipendOrAmount: "₹25,000/month",
    applyUrl: "https://example.com/apply/nimbus-swe-intern",
    requiredDocuments: ["Resume", "Transcript", "SOP"],
  },
  {
    title: "AI/ML Research Internship",
    organization: "Vertex AI Labs",
    type: "Internship",
    description: "Work on applied NLP and computer vision projects with a research mentor.",
    deadline: daysFromNow(14),
    eligibility: "3rd/4th year students with ML coursework or projects",
    minCgpa: 7.5,
    requiredSkills: ["Python", "Machine Learning", "TensorFlow", "PyTorch"],
    relatedInterests: ["AI/ML", "Research"],
    location: "Hybrid - Bengaluru",
    stipendOrAmount: "₹30,000/month",
    applyUrl: "https://example.com/apply/vertex-ai-intern",
    requiredDocuments: ["Resume", "Transcript", "SOP"],
  },
  {
    title: "National Merit Scholarship for Engineering Students",
    organization: "Ministry of Education Foundation",
    type: "Scholarship",
    description: "Merit-based scholarship covering tuition fees for high-performing engineering students.",
    deadline: daysFromNow(21),
    eligibility: "All B.Tech students with CGPA above 8.0",
    minCgpa: 8.0,
    requiredSkills: [],
    relatedInterests: [],
    location: "National (India)",
    stipendOrAmount: "₹1,00,000/year",
    applyUrl: "https://example.com/apply/merit-scholarship",
    requiredDocuments: ["Transcript", "SOP"],
  },
  {
    title: "Women in Computer Science Scholarship",
    organization: "TechForward Foundation",
    type: "Scholarship",
    description: "Supporting women pursuing degrees in computer science and related fields.",
    deadline: daysFromNow(30),
    eligibility: "Female students enrolled in CS/IT programs",
    minCgpa: 6.5,
    requiredSkills: [],
    relatedInterests: ["Computer Science"],
    location: "National (India)",
    stipendOrAmount: "₹50,000",
    applyUrl: "https://example.com/apply/wics-scholarship",
    requiredDocuments: ["Transcript", "SOP", "Certificates"],
  },
  {
    title: "Global Innovation Fellowship",
    organization: "Fenwick Institute",
    type: "Fellowship",
    description: "12-month fellowship supporting student-led projects with social or technical impact.",
    deadline: daysFromNow(18),
    eligibility: "Undergraduate students with a project idea and a working prototype",
    minCgpa: 7.0,
    requiredSkills: ["Project Management", "Product Thinking"],
    relatedInterests: ["Entrepreneurship", "Social Impact"],
    location: "Remote",
    stipendOrAmount: "$2,000",
    applyUrl: "https://example.com/apply/global-innovation-fellowship",
    requiredDocuments: ["Resume", "SOP"],
  },
  {
    title: "Research Fellowship in Data Science",
    organization: "Bhopal Institute of Advanced Studies",
    type: "Fellowship",
    description: "Assist faculty on a funded data science research project for one semester.",
    deadline: daysFromNow(12),
    eligibility: "Students with coursework in statistics or data science",
    minCgpa: 7.5,
    requiredSkills: ["Python", "Data Analysis", "SQL"],
    relatedInterests: ["Data Science", "Research"],
    location: "On-campus",
    stipendOrAmount: "₹10,000/month",
    applyUrl: "https://example.com/apply/bias-research-fellowship",
    requiredDocuments: ["Resume", "Transcript", "SOP"],
  },
  {
    title: "National Coding Championship 2026",
    organization: "CodeArena",
    type: "Competition",
    description: "Individual competitive programming contest with cash prizes and internship offers.",
    deadline: daysFromNow(6),
    eligibility: "Open to all undergraduate students",
    minCgpa: 0,
    requiredSkills: ["Data Structures", "Algorithms", "C++"],
    relatedInterests: ["Competitive Programming"],
    location: "Online",
    stipendOrAmount: "₹2,00,000 prize pool",
    applyUrl: "https://example.com/apply/national-coding-championship",
    requiredDocuments: ["Resume"],
  },
  {
    title: "Smart India Hackathon",
    organization: "Government of India (AICTE)",
    type: "Competition",
    description: "36-hour national hackathon solving real-world problem statements from ministries and industry.",
    deadline: daysFromNow(25),
    eligibility: "Teams of undergraduate students from AICTE-approved institutes",
    minCgpa: 0,
    requiredSkills: ["Full Stack Development", "Problem Solving"],
    relatedInterests: ["Web Development", "Social Impact"],
    location: "Multiple centers - India",
    stipendOrAmount: "₹1,00,000 per winning team",
    applyUrl: "https://example.com/apply/sih",
    requiredDocuments: ["Resume"],
  },
  {
    title: "UI/UX Design Challenge",
    organization: "PixelCraft Studio",
    type: "Competition",
    description: "Design challenge for a real client brief judged by industry designers.",
    deadline: daysFromNow(10),
    eligibility: "Open to students with a design portfolio",
    minCgpa: 0,
    requiredSkills: ["UI/UX Design", "Figma"],
    relatedInterests: ["Design", "Product"],
    location: "Online",
    stipendOrAmount: "₹25,000",
    applyUrl: "https://example.com/apply/pixelcraft-challenge",
    requiredDocuments: ["Resume", "Certificates"],
  },
  {
    title: "Student Innovation Micro-Grant",
    organization: "Bhopal Startup Council",
    type: "Grant",
    description: "Seed funding for early-stage student projects and prototypes.",
    deadline: daysFromNow(16),
    eligibility: "Student teams with a working prototype or MVP",
    minCgpa: 0,
    requiredSkills: ["Entrepreneurship", "Product Development"],
    relatedInterests: ["Entrepreneurship", "Startups"],
    location: "Madhya Pradesh, India",
    stipendOrAmount: "₹75,000",
    applyUrl: "https://example.com/apply/bsc-micro-grant",
    requiredDocuments: ["Resume", "SOP"],
  },
  {
    title: "Open Source Contribution Grant",
    organization: "OpenSource Collective",
    type: "Grant",
    description: "Grant for students actively maintaining or contributing to open-source projects.",
    deadline: daysFromNow(20),
    eligibility: "Students with public GitHub contributions",
    minCgpa: 0,
    requiredSkills: ["Git", "Open Source", "JavaScript"],
    relatedInterests: ["Open Source", "Web Development"],
    location: "Remote",
    stipendOrAmount: "$500",
    applyUrl: "https://example.com/apply/osc-grant",
    requiredDocuments: ["Resume", "SOP"],
  },
  {
    title: "Summer Research Program",
    organization: "VIT Bhopal University",
    type: "University Program",
    description: "8-week on-campus research immersion program across CS, ECE and Mechanical departments.",
    deadline: daysFromNow(11),
    eligibility: "VIT Bhopal students, 2nd year and above",
    minCgpa: 6.5,
    requiredSkills: [],
    relatedInterests: ["Research"],
    location: "On-campus - VIT Bhopal",
    stipendOrAmount: "Certificate + Stipend",
    applyUrl: "https://example.com/apply/vit-summer-research",
    requiredDocuments: ["Transcript"],
  },
  {
    title: "Semester Exchange Program - Singapore",
    organization: "VIT Bhopal International Office",
    type: "University Program",
    description: "One semester student exchange with a partner university in Singapore.",
    deadline: daysFromNow(28),
    eligibility: "3rd year students with CGPA above 7.5 and no active backlogs",
    minCgpa: 7.5,
    requiredSkills: [],
    relatedInterests: ["International Exposure"],
    location: "Singapore",
    stipendOrAmount: "Partial fee waiver",
    applyUrl: "https://example.com/apply/vit-exchange-singapore",
    requiredDocuments: ["Transcript", "SOP", "Certificates"],
  },
  {
    title: "Cybersecurity Bootcamp Fellowship",
    organization: "SecureNet Foundation",
    type: "Fellowship",
    description: "6-week intensive cybersecurity bootcamp with certification and job referrals.",
    deadline: daysFromNow(8),
    eligibility: "Students interested in security, networking, or systems",
    minCgpa: 6.0,
    requiredSkills: ["Networking", "Linux", "Security"],
    relatedInterests: ["Cybersecurity"],
    location: "Remote",
    stipendOrAmount: "Free + Certification",
    applyUrl: "https://example.com/apply/securenet-fellowship",
    requiredDocuments: ["Resume", "SOP"],
  },
  {
    title: "Cloud Computing Internship",
    organization: "SkyForge Technologies",
    type: "Internship",
    description: "Internship focused on AWS infrastructure, CI/CD pipelines, and DevOps practices.",
    deadline: daysFromNow(15),
    eligibility: "3rd/4th year CS/IT students familiar with cloud basics",
    minCgpa: 7.0,
    requiredSkills: ["AWS", "Docker", "CI/CD"],
    relatedInterests: ["Cloud Computing", "DevOps"],
    location: "Remote",
    stipendOrAmount: "₹20,000/month",
    applyUrl: "https://example.com/apply/skyforge-cloud-intern",
    requiredDocuments: ["Resume", "Transcript", "SOP"],
  },
];

async function seed() {
  await connectDB();

  console.log("[seed] Clearing existing demo data...");
  await Promise.all([
    User.deleteMany({}),
    Profile.deleteMany({}),
    Opportunity.deleteMany({}),
    Document.deleteMany({}),
    Application.deleteMany({}),
  ]);

  console.log("[seed] Creating demo user...");
  const user = await User.create({
    name: "Ketna Sharma",
    email: "ketna.sharma@vitbhopal.ac.in",
  });

  console.log("[seed] Creating demo profile...");
  await Profile.create({
    user: user._id,
    name: "Ketna Sharma",
    email: "ketna.sharma@vitbhopal.ac.in",
    university: "VIT Bhopal University",
    degree: "B.Tech",
    branch: "Computer Science",
    year: 3,
    cgpa: 8.4,
    skills: ["JavaScript", "React", "Node.js", "Python", "Machine Learning", "MongoDB", "Git"],
    interests: ["Web Development", "AI/ML", "Research", "Open Source"],
    experience:
      "Built two full-stack projects (CRM tool and campus canteen app), completed an ML coursework project on image classification.",
    preferredTypes: ["Internship", "Fellowship", "Competition"],
  });

  console.log("[seed] Setting up document vault (SOP intentionally missing)...");
  await Document.insertMany([
    { user: user._id, type: "Resume", status: "uploaded", fileName: "Ketna_Sharma_Resume.pdf", uploadedAt: new Date() },
    { user: user._id, type: "Transcript", status: "uploaded", fileName: "Ketna_Sharma_Transcript.pdf", uploadedAt: new Date() },
    { user: user._id, type: "Certificates", status: "uploaded", fileName: "Ketna_Sharma_Certificates.pdf", uploadedAt: new Date() },
    { user: user._id, type: "SOP", status: "missing", fileName: "" },
  ]);

  console.log(`[seed] Inserting ${opportunities.length} demo opportunities...`);
  await Opportunity.insertMany(opportunities);

  console.log("[seed] Done! Demo data is ready.");
  await mongoose.connection.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
