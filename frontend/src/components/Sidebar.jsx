import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  UserRound,
  Compass,
  FolderClock,
  FileStack,
  LifeBuoy,
} from "lucide-react";

const links = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/profile", label: "Profile", icon: UserRound },
  { to: "/discover", label: "Discover", icon: Compass },
  { to: "/documents", label: "Documents", icon: FileStack },
  { to: "/applications", label: "Applications", icon: FolderClock },
];

export default function Sidebar() {
  return (
    <aside className="hidden md:flex md:w-64 md:flex-col border-r border-navy-100 bg-surface">
      <div className="px-6 py-6 border-b border-navy-100">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl2 bg-navy-900 flex items-center justify-center">
            <LifeBuoy className="h-5 w-5 text-rescue-300" />
          </div>
          <div>
            <p className="font-display font-bold text-navy-900 leading-tight">Rescue Agent</p>
            <p className="text-xs text-navy-500 leading-tight">Application Recovery</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              [
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-navy-900 text-white"
                  : "text-navy-700 hover:bg-navy-50 hover:text-navy-900",
              ].join(" ")
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-4 py-4 border-t border-navy-100">
        <div className="rounded-lg bg-navy-50 px-3 py-3">
          <p className="text-xs font-semibold text-navy-700">Never auto-submits</p>
          <p className="text-xs text-navy-500 mt-1">
            The Rescue Agent fills and fixes - you always give the final approval.
          </p>
        </div>
      </div>
    </aside>
  );
}
