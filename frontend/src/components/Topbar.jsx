import { NavLink } from "react-router-dom";
import { LayoutDashboard, UserRound, Compass, FolderClock, FileStack } from "lucide-react";

const links = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/profile", label: "Profile", icon: UserRound },
  { to: "/discover", label: "Discover", icon: Compass },
  { to: "/documents", label: "Documents", icon: FileStack },
  { to: "/applications", label: "Applications", icon: FolderClock },
];

export default function Topbar({ title }) {
  return (
    <header className="sticky top-0 z-10 bg-surface/95 backdrop-blur border-b border-navy-100">
      <div className="px-4 md:px-8 py-4 flex items-center justify-between">
        <h1 className="text-lg md:text-xl font-display font-bold text-navy-900">{title}</h1>
      </div>
      <nav className="md:hidden flex overflow-x-auto gap-1 px-3 pb-3">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              [
                "flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium",
                isActive ? "bg-navy-900 text-white" : "bg-navy-50 text-navy-700",
              ].join(" ")
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
