import { motion } from "framer-motion";
import { Zap } from "lucide-react";

interface FocusScoreWidgetProps {
  streakDays:       number;
  focusMinToday:    number;
  tasksCompleted:   number;
  tasksTotal:       number;
  quizzesToday:     number;
}

function computeScore({
  streakDays, focusMinToday, tasksCompleted, tasksTotal, quizzesToday,
}: FocusScoreWidgetProps): number {
  const streakScore  = Math.min(25, streakDays * 3);
  const focusScore   = Math.min(35, Math.round(focusMinToday / 2));
  const taskScore    = tasksTotal > 0
    ? Math.min(25, Math.round((tasksCompleted / tasksTotal) * 25))
    : 0;
  const quizScore    = Math.min(15, quizzesToday * 5);
  return streakScore + focusScore + taskScore + quizScore;
}

const TIERS = [
  { min: 80, label: "🔥 Hyperfocus",  color: "text-accent",       bg: "bg-accent/10",     ring: "ring-accent/40" },
  { min: 60, label: "⚡ In forma",    color: "text-primary",      bg: "bg-primary/10",    ring: "ring-primary/40" },
  { min: 40, label: "📚 Attivo",      color: "text-blue-500",     bg: "bg-blue-500/10",   ring: "ring-blue-500/30" },
  { min: 20, label: "🌱 In partenza", color: "text-orange-500",   bg: "bg-orange-500/10", ring: "ring-orange-500/30" },
  { min:  0, label: "😴 Riposati",    color: "text-muted-foreground", bg: "bg-secondary", ring: "ring-border" },
];

export default function FocusScoreWidget(props: FocusScoreWidgetProps) {
  const score = computeScore(props);
  const tier  = TIERS.find((t) => score >= t.min)!;

  // Arc path for the circular gauge
  const radius   = 40;
  const circ     = 2 * Math.PI * radius;
  const progress = (score / 100) * circ;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`rounded-xl border p-4 ${tier.bg} flex items-center gap-4`}
    >
      {/* Circular gauge */}
      <div className="relative shrink-0 h-20 w-20">
        <svg width="80" height="80" className="-rotate-90">
          <circle
            cx="40" cy="40" r={radius}
            strokeWidth="7"
            stroke="hsl(var(--border))"
            fill="none"
          />
          <circle
            cx="40" cy="40" r={radius}
            strokeWidth="7"
            stroke="currentColor"
            fill="none"
            strokeDasharray={circ}
            strokeDashoffset={circ - progress}
            strokeLinecap="round"
            className={`transition-all duration-700 ${tier.color}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-xl font-bold leading-none ${tier.color}`}>{score}</span>
          <span className="text-[9px] text-muted-foreground leading-none mt-0.5">/ 100</span>
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <Zap className={`h-4 w-4 ${tier.color}`} />
          <span className="text-sm font-semibold text-card-foreground">Focus Score</span>
        </div>
        <p className={`text-sm font-bold ${tier.color}`}>{tier.label}</p>

        {/* Breakdown */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-2">
          {[
            { label: "Streak",    pts: Math.min(25, props.streakDays * 3) },
            { label: "Focus",     pts: Math.min(35, Math.round(props.focusMinToday / 2)) },
            { label: "Task",      pts: props.tasksTotal > 0 ? Math.min(25, Math.round((props.tasksCompleted / props.tasksTotal) * 25)) : 0 },
            { label: "Quiz",      pts: Math.min(15, props.quizzesToday * 5) },
          ].map((b) => (
            <div key={b.label} className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">{b.label}</span>
              <span className="font-medium text-card-foreground">{b.pts}</span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
