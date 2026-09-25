import { Routes, Route, useLocation } from "react-router-dom";
import Sidebar from "./components/Sidebar.jsx";
import Topbar from "./components/Topbar.jsx";

import Dashboard from "./pages/Dashboard.jsx";
import Profile from "./pages/Profile.jsx";
import Discover from "./pages/Discover.jsx";
import OpportunityDetails from "./pages/OpportunityDetails.jsx";
import Documents from "./pages/Documents.jsx";
import Applications from "./pages/Applications.jsx";
import ApplicationRescue from "./pages/ApplicationRescue.jsx";

const TITLES = {
  "/": "Dashboard",
  "/profile": "Your Profile",
  "/discover": "Discover Opportunities",
  "/documents": "Document Vault",
  "/applications": "Your Applications",
};

function pageTitle(pathname) {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith("/discover/")) return "Opportunity Details";
  if (pathname.startsWith("/applications/")) return "Application Rescue";
  return "Application Rescue Agent";
}

export default function App() {
  const location = useLocation();

  return (
    <div className="min-h-screen flex bg-paper">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar title={pageTitle(location.pathname)} />
        <main className="flex-1 px-4 md:px-8 py-6 max-w-6xl w-full mx-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/discover/:id" element={<OpportunityDetails />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/applications" element={<Applications />} />
            <Route path="/applications/:id" element={<ApplicationRescue />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
