import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Trophy, Medal, Crown, Star, Flame, Gift, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import AppHeader from "@/components/AppHeader";

interface LeaderboardEntry {
  user_id: string;
  total_xp: number;
  level: number;
  quizzes_completed: number;
  full_name: string | null;
  streak_count: number;
}

const PRIZES = [
  { rank: 1, icon: "👑", label: "1° posto", prize: "1 mese Hyperfocus Master gratis", color: "from-yellow-400 to-amber-500" },
  { rank: 2, icon: "🥈", label: "2° posto", prize: "50% sconto Focus Pro", color: "from-gray-300 to-gray-400" },
  { rank: 3, icon: "🥉", label: "3° posto", prize: "30% sconto Focus Pro", color: "from-orange-300 to-orange-400" },
];

const Leaderboard = () => {
  const { user } = useAuth();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [userRank, setUserRank] = useState<number | null>(null);

  useEffect(() => {
    const fetch = async () => {
      // Use the secure leaderboard view that only exposes non-sensitive data
      const { data: leaderboardData } = await supabase
        .from("leaderboard_view")
        .select("user_id, full_name, avatar_url, streak_count, total_xp, level, quizzes_completed")
        .order("total_xp", { ascending: false })
        .limit(50);

      if (!leaderboardData) { setLoading(false); return; }

      const combined: LeaderboardEntry[] = (leaderboardData as any[]).map(x => ({
        user_id: x.user_id,
        total_xp: x.total_xp,
        level: x.level,
        quizzes_completed: x.quizzes_completed,
        full_name: x.full_name || "Studente",
        streak_count: x.streak_count || 0,
      }));

      setEntries(combined);

      // Find user rank
      if (user) {
        const idx = combined.findIndex(e => e.user_id === user.id);
        setUserRank(idx >= 0 ? idx + 1 : null);
      }

      setLoading(false);
    };
    fetch();
  }, [user]);

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard"><ArrowLeft className="h-4 w-4 mr-2" /> Dashboard</Link>
          </Button>
        </div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3 mb-2">
            <Trophy className="h-7 w-7 text-accent" />
            <h1 className="text-2xl font-bold text-foreground">Classifica</h1>
          </div>
          <p className="text-muted-foreground mb-8">I migliori studenti della piattaforma. La top 3 vince premi ogni settimana!</p>
          {/* GDPR notice */}
          <div className="bg-secondary/50 rounded-lg px-4 py-2 mb-6 flex items-start gap-2">
            <span className="text-xs text-muted-foreground">
              🔒 Solo gli utenti che hanno attivato la visibilità pubblica appaiono in classifica.
              Puoi gestire questa impostazione in <a href="/profile" className="underline">Profilo → Impostazioni privacy</a>.
            </span>
          </div>

          {/* Prizes */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            {PRIZES.map((p) => (
              <div key={p.rank} className={`bg-gradient-to-br ${p.color} rounded-xl p-4 text-center text-white`}>
                <div className="text-2xl mb-1">{p.icon}</div>
                <p className="text-xs font-bold">{p.label}</p>
                <p className="text-[10px] opacity-90 mt-1">{p.prize}</p>
              </div>
            ))}
          </div>

          {/* User position */}
          {userRank && (
            <div className="bg-primary/10 rounded-xl border border-primary/30 p-4 mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold text-primary">#{userRank}</span>
                <span className="text-sm text-card-foreground">La tua posizione</span>
              </div>
              {userRank <= 3 && (
                <Badge className="bg-accent text-accent-foreground">
                  <Gift className="h-3 w-3 mr-1" /> In zona premi!
                </Badge>
              )}
            </div>
          )}

          {/* Leaderboard list */}
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Nessun utente in classifica. Sii il primo!
            </div>
          ) : (
            <div className="space-y-2">
              {entries.map((entry, i) => {
                const rank = i + 1;
                const isCurrentUser = entry.user_id === user?.id;
                const isTop3 = rank <= 3;

                return (
                  <motion.div
                    key={entry.user_id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className={`flex items-center gap-4 p-4 rounded-xl border transition-all ${
                      isCurrentUser
                        ? "border-primary bg-primary/5 shadow-sm"
                        : isTop3
                        ? "border-accent/30 bg-accent/5"
                        : "border-border bg-card"
                    }`}
                  >
                    {/* Rank */}
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                      rank === 1 ? "bg-yellow-400 text-yellow-900" :
                      rank === 2 ? "bg-gray-300 text-gray-700" :
                      rank === 3 ? "bg-orange-300 text-orange-800" :
                      "bg-secondary text-secondary-foreground"
                    }`}>
                      {rank <= 3 ? PRIZES[rank - 1].icon : rank}
                    </div>

                    {/* Name */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-card-foreground truncate">
                        {entry.full_name || "Studente"}
                        {isCurrentUser && <span className="text-primary ml-1">(tu)</span>}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-0.5">
                          <Star className="h-3 w-3" /> Lv. {entry.level}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Flame className="h-3 w-3" /> {entry.streak_count}d
                        </span>
                        <span>{entry.quizzes_completed} quiz</span>
                      </div>
                    </div>

                    {/* XP */}
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-primary">{entry.total_xp.toLocaleString()}</p>
                      <p className="text-[10px] text-muted-foreground">XP</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>
      </main>
    </div>
  );
};

export default Leaderboard;
