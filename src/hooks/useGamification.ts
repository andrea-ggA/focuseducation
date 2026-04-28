import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getLocalDateString } from "@/lib/datetime";

export interface UserXP {
  total_xp:           number;
  level:              number;
  quizzes_completed:  number;
  perfect_scores:     number;
  current_streak:     number;
}

export interface Achievement {
  achievement_type: string;
  earned_at:        string;
}

export const BADGE_DEFINITIONS: Record<string, { name: string; description: string; icon: string }> = {
  first_quiz:      { name: "Primo Quiz",         description: "Completa il tuo primo quiz",              icon: "🎯" },
  quiz_5:          { name: "Quiz Master",         description: "Completa 5 quiz",                        icon: "🧠" },
  quiz_20:         { name: "Studioso",            description: "Completa 20 quiz",                       icon: "📚" },
  perfect_score:   { name: "Perfezionista",       description: "Ottieni un punteggio perfetto",           icon: "💯" },
  perfect_5:       { name: "Genio",               description: "5 punteggi perfetti",                    icon: "🌟" },
  streak_3:        { name: "Costante",            description: "3 giorni consecutivi",                   icon: "🔥" },
  streak_7:        { name: "Settimana perfetta",  description: "7 giorni consecutivi",                   icon: "⚡" },
  streak_30:       { name: "Inarrestabile",       description: "30 giorni consecutivi",                  icon: "🏆" },
  focus_60:        { name: "Concentrato",         description: "60 minuti di focus in un giorno",        icon: "⏱️" },
  focus_300:       { name: "Maratoneta",          description: "300 minuti totali di focus",             icon: "🏅" },
  level_5:         { name: "Livello 5",           description: "Raggiungi il livello 5",                 icon: "⭐" },
  level_10:        { name: "Livello 10",          description: "Raggiungi il livello 10",                icon: "💎" },
  tasks_10:        { name: "Produttivo",          description: "Completa 10 task",                       icon: "✅" },
  tasks_50:        { name: "Macchina",            description: "Completa 50 task",                       icon: "🚀" },
  streak_shield:   { name: "Scudo Streak",        description: "Vinto alla ruota della fortuna",         icon: "🛡️" },
  fortune_winner:  { name: "Fortunato",           description: "Badge dalla ruota della fortuna",        icon: "🍀" },
  rare_collector:  { name: "Collezionista Raro",  description: "Badge raro dalla ruota",                 icon: "💫" },
};

export const useGamification = () => {
  const { user } = useAuth();
  const [xp,           setXp]           = useState<UserXP | null>(null);
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [streakCount,  setStreakCount]  = useState(0);

  const fetchAll = useCallback(async () => {
    if (!user) {
      setXp(null);
      setAchievements([]);
      setStreakCount(0);
      setLoading(false);
      return;
    }

    try {
      // Promise.allSettled: each query fails independently — never blocks UI
      const [xpRes, achRes, profileRes] = await Promise.allSettled([
        supabase.from("user_xp").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("achievements").select("achievement_type, earned_at").eq("user_id", user.id),
        // maybeSingle instead of single — prevents PGRST116 crash for new users
        supabase.from("profiles").select("streak_count, last_active_date").eq("user_id", user.id).maybeSingle(),
      ]);

      // --- XP ---
      if (xpRes.status === "fulfilled" && !xpRes.value.error) {
        if (xpRes.value.data) {
          setXp(xpRes.value.data);
        } else {
          await supabase.from("user_xp").insert({ user_id: user.id });
          setXp({ total_xp: 0, level: 1, quizzes_completed: 0, perfect_scores: 0, current_streak: 0 });
        }
      } else {
        console.error("[useGamification] XP fetch failed");
        setXp({ total_xp: 0, level: 1, quizzes_completed: 0, perfect_scores: 0, current_streak: 0 });
      }

      // --- Achievements ---
      if (achRes.status === "fulfilled" && !achRes.value.error) {
        setAchievements(achRes.value.data ?? []);
      } else {
        console.error("[useGamification] Achievements fetch failed");
        setAchievements([]);
      }

      // --- Streak (FIX: operazione atomica server-side via RPC con FOR UPDATE lock) ---
      // Previene race condition multi-tab che causava doppio incremento streak
      // e consumo multiplo dello streak_freeze power-up
      try {
        const { data: streakResult, error: streakError } = await supabase.rpc("update_daily_streak", {
          _user_id: user.id,
          _today: getLocalDateString(),
        });
        if (streakError) {
          console.error("[useGamification] streak RPC error:", streakError);
          if (profileRes.status === "fulfilled" && profileRes.value.data) {
            setStreakCount(profileRes.value.data.streak_count || 0);
          }
        } else {
          const streakData = streakResult as { streak?: number } | null;
          setStreakCount(streakData?.streak ?? 0);
        }
      } catch (streakErr) {
        console.error("[useGamification] streak update failed:", streakErr);
        if (profileRes.status === "fulfilled" && profileRes.value.data) {
          setStreakCount(profileRes.value.data.streak_count || 0);
        }
      }
    } catch (err) {
      console.error("[useGamification] Unexpected error:", err);
    } finally {
      // ALWAYS resolves loading — UI never hangs
      setLoading(false);
    }
  }, [user]);

  const checkBadges = useCallback(
    async (
      currentXp:           UserXP,
      currentAchievements: Achievement[],
      extraData?:          { focusMinutesToday?: number; completedTasks?: number; totalFocusMinutes?: number },
    ) => {
      if (!user) return [];
      const earned    = new Set(currentAchievements.map((a) => a.achievement_type));
      const newBadges: string[] = [];

      if (currentXp.quizzes_completed >= 1  && !earned.has("first_quiz"))    newBadges.push("first_quiz");
      if (currentXp.quizzes_completed >= 5  && !earned.has("quiz_5"))        newBadges.push("quiz_5");
      if (currentXp.quizzes_completed >= 20 && !earned.has("quiz_20"))       newBadges.push("quiz_20");
      if (currentXp.perfect_scores >= 1     && !earned.has("perfect_score")) newBadges.push("perfect_score");
      if (currentXp.perfect_scores >= 5     && !earned.has("perfect_5"))     newBadges.push("perfect_5");
      if (streakCount >= 3  && !earned.has("streak_3"))  newBadges.push("streak_3");
      if (streakCount >= 7  && !earned.has("streak_7"))  newBadges.push("streak_7");
      if (streakCount >= 30 && !earned.has("streak_30")) newBadges.push("streak_30");
      if (currentXp.level >= 5  && !earned.has("level_5"))  newBadges.push("level_5");
      if (currentXp.level >= 10 && !earned.has("level_10")) newBadges.push("level_10");
      if (extraData?.focusMinutesToday  && extraData.focusMinutesToday  >= 60  && !earned.has("focus_60"))  newBadges.push("focus_60");
      if (extraData?.totalFocusMinutes  && extraData.totalFocusMinutes  >= 300 && !earned.has("focus_300")) newBadges.push("focus_300");
      if (extraData?.completedTasks     && extraData.completedTasks     >= 10  && !earned.has("tasks_10")) newBadges.push("tasks_10");
      if (extraData?.completedTasks     && extraData.completedTasks     >= 50  && !earned.has("tasks_50")) newBadges.push("tasks_50");

      if (newBadges.length > 0) {
        // Use the server-side award_achievement() RPC (SECURITY DEFINER) instead of
        // a direct insert. The secure_achievements migration revoked direct INSERT
        // from the client to prevent users from self-awarding badges via DevTools.
        // The RPC validates conditions server-side before inserting.
        const awarded: string[] = [];
        await Promise.allSettled(
          newBadges.map(async (type) => {
            const { data, error } = await supabase.rpc("award_achievement", {
              _user_id:          user.id,
              _achievement_type: type,
            });
            // Returns TRUE if newly awarded, FALSE if conditions not met or already has badge
            if (!error && data === true) awarded.push(type);
          }),
        );
        if (awarded.length > 0) {
          setAchievements((prev) => [
            ...prev,
            ...awarded.map((t) => ({ achievement_type: t, earned_at: new Date().toISOString() })),
          ]);
        }
        // Return only the badges that were actually awarded server-side
        return awarded;
      }

      return newBadges;
    },
    [user, streakCount],
  );

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Both formulas derived exclusively from total_xp — always mathematically consistent
  const xpInLevel    = xp ? xp.total_xp % 500 : 0;
  const xpToNextLevel = 500 - xpInLevel;
  const xpProgress    = (xpInLevel / 500) * 100;

  return {
    xp,
    achievements,
    streakCount,
    loading,
    checkBadges,
    refreshGamification: fetchAll,
    xpToNextLevel,   // always positive
    xpProgress,      // coherent with xpToNextLevel
    badgeCount: achievements.length,
  };
};
