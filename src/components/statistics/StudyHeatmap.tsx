import { useMemo, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CalendarDays } from "lucide-react";

interface HeatmapData {
  date: string; // YYYY-MM-DD
  minutes: number;
}

interface StudyHeatmapProps {
  focusSessions: { duration_minutes: number; started_at: string }[];
  quizAttempts: { completed_at: string }[];
}

const MONTHS_IT = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
const DAYS_IT = ["Lun", "", "Mer", "", "Ven", "", "Dom"];

const getIntensityClass = (minutes: number): string => {
  if (minutes === 0) return "bg-secondary/60 dark:bg-secondary/30";
  if (minutes < 15) return "bg-primary/20";
  if (minutes < 30) return "bg-primary/40";
  if (minutes < 60) return "bg-primary/60";
  return "bg-primary/90";
};

const StudyHeatmap = ({ focusSessions, quizAttempts }: StudyHeatmapProps) => {
  const [hoveredDay, setHoveredDay] = useState<HeatmapData | null>(null);

  const { grid, monthLabels, totalDays, activeDays, longestStreak, totalMinutes } = useMemo(() => {
    // Build 26-week (182 days) grid
    const totalWeeks = 26;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Find the start (Monday of the first week)
    const endDay = new Date(today);
    const startDay = new Date(today);
    startDay.setDate(startDay.getDate() - (totalWeeks * 7 - 1));
    // Align to Monday
    const dayOfWeek = startDay.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    startDay.setDate(startDay.getDate() + mondayOffset);

    // Aggregate focus minutes by date
    const minutesByDate: Record<string, number> = {};
    focusSessions.forEach((s) => {
      const key = new Date(s.started_at).toISOString().split("T")[0];
      minutesByDate[key] = (minutesByDate[key] || 0) + s.duration_minutes;
    });
    // Add quiz activity (count each quiz as ~5 min activity to show on heatmap)
    quizAttempts.forEach((q) => {
      const key = new Date(q.completed_at).toISOString().split("T")[0];
      minutesByDate[key] = (minutesByDate[key] || 0) + 5;
    });

    // Build grid: weeks × 7 days
    const grid: (HeatmapData | null)[][] = [];
    const monthLabels: { label: string; weekIndex: number }[] = [];
    let lastMonth = -1;
    const currentDate = new Date(startDay);
    let weekIndex = 0;
    let currentWeek: (HeatmapData | null)[] = [];
    let totalDays = 0;
    let activeDays = 0;
    let totalMinutes = 0;
    let currentStreak = 0;
    let longestStreak = 0;

    while (currentDate <= endDay) {
      const dayIdx = (currentDate.getDay() + 6) % 7; // Monday=0, Sunday=6

      if (dayIdx === 0 && currentWeek.length > 0) {
        grid.push(currentWeek);
        currentWeek = [];
        weekIndex++;
      }

      // Fill gaps at start
      while (currentWeek.length < dayIdx) {
        currentWeek.push(null);
      }

      const dateStr = currentDate.toISOString().split("T")[0];
      const minutes = minutesByDate[dateStr] || 0;
      currentWeek.push({ date: dateStr, minutes });

      // Month labels
      const month = currentDate.getMonth();
      if (month !== lastMonth) {
        monthLabels.push({ label: MONTHS_IT[month], weekIndex: grid.length });
        lastMonth = month;
      }

      // Stats
      totalDays++;
      totalMinutes += minutes;
      if (minutes > 0) {
        activeDays++;
        currentStreak++;
        longestStreak = Math.max(longestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    if (currentWeek.length > 0) {
      // Pad to 7
      while (currentWeek.length < 7) currentWeek.push(null);
      grid.push(currentWeek);
    }

    return { grid, monthLabels, totalDays, activeDays, longestStreak, totalMinutes };
  }, [focusSessions, quizAttempts]);

  const consistencyPct = totalDays > 0 ? Math.round((activeDays / totalDays) * 100) : 0;

  return (
    <div className="bg-card rounded-xl border border-border shadow-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-card-foreground flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" /> Heatmap di Studio
        </h3>
        <span className="text-xs text-muted-foreground">Ultimi 6 mesi</span>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-4 mb-4 text-xs">
        <div>
          <span className="text-muted-foreground">Giorni attivi: </span>
          <span className="font-semibold text-card-foreground">{activeDays}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Costanza: </span>
          <span className="font-semibold text-primary">{consistencyPct}%</span>
        </div>
        <div>
          <span className="text-muted-foreground">Streak max: </span>
          <span className="font-semibold text-accent">{longestStreak}g</span>
        </div>
        <div>
          <span className="text-muted-foreground">Totale: </span>
          <span className="font-semibold text-card-foreground">{Math.round(totalMinutes / 60)}h {totalMinutes % 60}m</span>
        </div>
      </div>

      {/* Heatmap grid */}
      <div className="overflow-x-auto -mx-2 px-2 pb-2">
        <div className="inline-block min-w-0">
          {/* Month labels */}
          <div className="flex ml-8 mb-1">
            {monthLabels.map((m, i) => (
              <div
                key={i}
                className="text-[10px] text-muted-foreground"
                style={{ position: "relative", left: `${m.weekIndex * 14}px` }}
              >
                {m.label}
              </div>
            ))}
          </div>

          <div className="flex gap-0">
            {/* Day labels */}
            <div className="flex flex-col gap-[2px] mr-1 shrink-0">
              {DAYS_IT.map((d, i) => (
                <div key={i} className="h-[12px] w-6 text-[9px] text-muted-foreground flex items-center justify-end pr-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Weeks */}
            <div className="flex gap-[2px]">
              {grid.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-[2px]">
                  {week.map((day, di) => {
                    if (!day) {
                      return <div key={di} className="h-[12px] w-[12px]" />;
                    }
                    const dateObj = new Date(day.date);
                    const formatted = dateObj.toLocaleDateString("it-IT", {
                      weekday: "short", day: "numeric", month: "short",
                    });

                    return (
                      <Tooltip key={di}>
                        <TooltipTrigger asChild>
                          <div
                            className={`h-[12px] w-[12px] rounded-[2px] transition-all cursor-pointer hover:ring-1 hover:ring-primary/50 ${getIntensityClass(day.minutes)}`}
                            onMouseEnter={() => setHoveredDay(day)}
                            onMouseLeave={() => setHoveredDay(null)}
                          />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          <p className="font-medium">{formatted}</p>
                          <p className="text-muted-foreground">
                            {day.minutes === 0
                              ? "Nessuna attività"
                              : `${day.minutes} min di studio`}
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-1 mt-3 justify-end">
            <span className="text-[10px] text-muted-foreground mr-1">Meno</span>
            {[0, 10, 25, 45, 70].map((m) => (
              <div key={m} className={`h-[10px] w-[10px] rounded-[2px] ${getIntensityClass(m)}`} />
            ))}
            <span className="text-[10px] text-muted-foreground ml-1">Più</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudyHeatmap;
