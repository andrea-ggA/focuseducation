import { Brain, LogOut, Shield, Crown, Menu, Home, Sparkles, Trophy, User, BookOpen, Zap, CreditCard, Sun, Moon, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";
import { useUserRole } from "@/hooks/useUserRole";
import { useCredits } from "@/hooks/useCredits";
import { useTheme } from "next-themes";
import { useDueCards } from "@/hooks/useDueCards";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const AppHeader = () => {
  const { signOut } = useAuth();
  const { hasSubscription, subscription } = useSubscription();
  const { isAdmin } = useUserRole();
  const { totalCredits } = useCredits();
  const { pathname }  = useLocation();
  // Mostra badge solo su pagine di studio e dashboard — evita query RPC su ogni pagina
  const showDueBadge  = ["/dashboard", "/study", "/libreria", "/flashcard"].some(p => pathname.startsWith(p));
  const { dueCount }  = useDueCards();
  const { resolvedTheme, setTheme } = useTheme();

  const creditColor = totalCredits < 5
    ? "bg-destructive/10 text-destructive"
    : totalCredits < 10
    ? "bg-orange-500/10 text-orange-600"
    : "bg-secondary text-muted-foreground";

  return (
    <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-40">
      <div className="container mx-auto flex items-center justify-between h-14 px-4">
        <div className="flex items-center gap-2 font-display font-bold text-lg text-card-foreground">
          <Brain className="h-6 w-6 text-primary" />
          <Link to="/dashboard" className="hover:text-primary transition-colors">FocusED</Link>
          {hasSubscription && (
            <Badge variant="default" className="ml-1 text-[10px]">
              <Crown className="h-3 w-3 mr-0.5" />
              {subscription?.plan_name}
            </Badge>
          )}
        </div>

        {/* Desktop nav - simplified to 5 items */}
        <nav className="hidden md:flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard"><Home className="h-4 w-4 mr-1.5" />Dashboard</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/study"><Sparkles className="h-4 w-4 mr-1.5" />Studio AI</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/libreria" className="relative inline-flex items-center gap-1.5"><BookOpen className="h-4 w-4 mr-1.5" />Libreria{showDueBadge && dueCount > 0 && <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center">{dueCount > 9 ? "9+" : dueCount}</span>}</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/statistiche"><BarChart3 className="h-4 w-4 mr-1.5" />Statistiche</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/leaderboard"><Trophy className="h-4 w-4 mr-1.5" />Classifica</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/pricing"><CreditCard className="h-4 w-4 mr-1.5" />Piani</Link>
          </Button>
          {isAdmin && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/admin"><Shield className="h-4 w-4 mr-1.5" />Admin</Link>
            </Button>
          )}
        </nav>

        <div className="flex items-center gap-2">
          {/* Mobile dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link to="/dashboard" className="flex items-center gap-2">
                  <Home className="h-4 w-4" /> Dashboard
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/study" className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" /> Studio AI
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/libreria" className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4" /> Libreria
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/statistiche" className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Statistiche
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/leaderboard" className="flex items-center gap-2">
                  <Trophy className="h-4 w-4" /> Classifica
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/pricing" className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4" /> Piani
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/profile" className="flex items-center gap-2">
                  <User className="h-4 w-4" /> Profilo
                </Link>
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem asChild>
                  <Link to="/admin" className="flex items-center gap-2">
                    <Shield className="h-4 w-4" /> Admin
                  </Link>
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut} className="text-destructive">
                <LogOut className="h-4 w-4 mr-2" /> Esci
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Credits badge - visible on both mobile and desktop */}
          <Link to="/pricing" className={`flex items-center gap-1 text-xs font-medium rounded-full px-3 py-1.5 transition-colors ${creditColor}`}>
            <Zap className="h-3 w-3" />
            <span>{totalCredits} cr</span>
          </Link>

          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")} aria-label="Cambia tema">
            {resolvedTheme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" asChild className="hidden md:flex">
            <Link to="/profile"><User className="h-4 w-4 mr-2" />Profilo</Link>
          </Button>
          <Button variant="ghost" size="sm" onClick={signOut} className="hidden md:flex">
            <LogOut className="h-4 w-4 mr-2" />
            Esci
          </Button>
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
