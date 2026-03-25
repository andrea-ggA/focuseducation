import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ExamInfo {
  exam_date:      string | null;
  exam_subject:   string | null;
  study_subject:  string | null;
  weekly_goal_minutes: number;
}

export interface ExamCountdown {
  daysLeft:         number | null;
  weeksLeft:        number | null;
  urgency:          "safe" | "warning" | "urgent" | "today";
  weeklyProgress:   number;   // minutes studied this week
  weeklyGoal:       number;   // target minutes/week
  weeklyPercent:    number;   // 0-100
}

export function useExamCountdown() {
  const { user }                    = useAuth();
  const [examInfo, setExamInfo]     = useState<ExamInfo | null>(null);
  const [countdown, setCountdown]   = useState<ExamCountdown | null>(null);
  const [loading, setLoading]       = useState(true);

  const fetch = useCallback(async () => {
    if (!user) return;

    const [profileRes, focusRes] = await Promise.allSettled([
      supabase
        .from("profiles")
        .select("exam_date, exam_subject, study_subject, weekly_goal_minutes")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("focus_sessions")
        .select("duration_minutes")
        .eq("user_id", user.id)
        .eq("completed", true)
        .gte("started_at", getStartOfWeek()),
    ]);

    if (profileRes.status === "fulfilled" && profileRes.value.data) {
      const info = profileRes.value.data as ExamInfo;
      setExamInfo(info);

      if (info.exam_date) {
        const today    = new Date();
        today.setHours(0, 0, 0, 0);
        const examDay  = new Date(info.exam_date);
        examDay.setHours(0, 0, 0, 0);
        const diffMs   = examDay.getTime() - today.getTime();
        const daysLeft = Math.round(diffMs / 86_400_000);
        const weeklyGoal = info.weekly_goal_minutes || 120;

        let weeklyProgress = 0;
        if (focusRes.status === "fulfilled" && focusRes.value.data) {
          weeklyProgress = focusRes.value.data.reduce(
            (sum, s) => sum + (s.duration_minutes || 0), 0
          );
        }

        setCountdown({
          daysLeft,
          weeksLeft: Math.max(0, Math.floor(daysLeft / 7)),
          urgency:   daysLeft <= 0 ? "today" : daysLeft <= 7 ? "urgent" : daysLeft <= 21 ? "warning" : "safe",
          weeklyProgress,
          weeklyGoal,
          weeklyPercent: Math.min(100, Math.round((weeklyProgress / weeklyGoal) * 100)),
        });
      }
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { fetch(); }, [fetch]);

  const saveExam = useCallback(async (date: string, subject: string) => {
    if (!user) return;
    await supabase
      .from("profiles")
      .update({ exam_date: date, exam_subject: subject } as any)
      .eq("user_id", user.id);
    setExamInfo((prev) => prev ? { ...prev, exam_date: date, exam_subject: subject } : prev);
    fetch();
  }, [user, fetch]);

  return { examInfo, countdown, loading, saveExam, refresh: fetch };
}

function getStartOfWeek(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
