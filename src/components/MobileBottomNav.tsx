import { Home, Sparkles, BookOpen, User } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useDueCards } from "@/hooks/useDueCards";

const NAV_ITEMS = [
  { icon: Home, label: "Home", path: "/dashboard", showBadge: false },
  { icon: Sparkles, label: "Studio", path: "/study", showBadge: false },
  { icon: BookOpen, label: "Libreria", path: "/libreria", showBadge: true },
  { icon: User, label: "Profilo", path: "/profile", showBadge: false },
];

const MobileBottomNav = () => {
  const { pathname }            = useLocation();
  const { dueCount }            = useDueCards();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border safe-area-bottom">
      <div className="flex items-center justify-around h-16 px-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.path || pathname.startsWith(item.path + "/");
          const showDueBadge = item.showBadge && dueCount > 0;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-colors min-w-0 relative ${
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <div className="relative">
                <item.icon className={`h-5 w-5 ${isActive ? "text-primary" : ""}`} />
                {showDueBadge && (
                  <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">
                    {dueCount > 9 ? "9+" : dueCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium truncate">{item.label}</span>
              {isActive && <div className="h-0.5 w-4 bg-primary rounded-full mt-0.5" />}
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
