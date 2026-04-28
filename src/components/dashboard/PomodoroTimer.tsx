import { useState, useEffect, useRef, useCallback, useMemo } from "react";
// FIX: Web Worker per timer preciso su mobile — iOS Safari throttola setInterval
// quando la tab è in background (schermo spento durante sessione Pomodoro)
const createTimerWorker = () =>
  new Worker(new URL("../../workers/timerWorker.ts", import.meta.url), { type: "module" });
import { Button } from "@/components/ui/button";
import { Timer, Play, Pause, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import DopamineBreak from "@/components/dashboard/DopamineBreak";
import type { EnergyLevel } from "@/components/dashboard/EnergySelector";
import { AMBIENT_SOUNDS } from "@/lib/ambientSounds";
import { awardUserXp } from "@/lib/progression";

type TimerPhase = "focus" | "short_break" | "long_break";

interface PomodoroConfig {
  focus: number;
  shortBreak: number;
  longBreak: number;
  sessionsBeforeLong: number;
}

const DEFAULT_CONFIG: PomodoroConfig = {
  focus: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
  sessionsBeforeLong: 4,
};


// Generate ambient sounds using Web Audio API
interface AmbientSoundNodes {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

const createAmbientSound = (type: string, audioCtx: AudioContext, volume: number): AmbientSoundNodes | null => {
  if (type === "none") return null;

  const bufferSize = 2 * audioCtx.sampleRate;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const output = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    output[i] = Math.random() * 2 - 1;
  }

  const whiteNoise = audioCtx.createBufferSource();
  whiteNoise.buffer = buffer;
  whiteNoise.loop = true;

  const filter = audioCtx.createBiquadFilter();
  const gain = audioCtx.createGain();
  gain.gain.value = volume;

  switch (type) {
    case "rain":
      filter.type = "lowpass";
      filter.frequency.value = 1200;
      break;
    case "forest":
      filter.type = "bandpass";
      filter.frequency.value = 800;
      filter.Q.value = 0.5;
      break;
    case "waves":
      filter.type = "lowpass";
      filter.frequency.value = 600;
      break;
    case "fire":
      filter.type = "lowpass";
      filter.frequency.value = 400;
      break;
  }

  whiteNoise.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  whiteNoise.start();

  return { source: whiteNoise, gain };
};

interface PomodoroTimerProps {
  energyLevel?: EnergyLevel;
  onSessionComplete?: () => void; // chiamato quando una sessione focus finisce
}

const PomodoroTimer = ({ energyLevel = "balanced", onSessionComplete }: PomodoroTimerProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [phase, setPhase] = useState<TimerPhase>("focus");
  const [timeLeft, setTimeLeft] = useState(DEFAULT_CONFIG.focus);
  const [isRunning, setIsRunning] = useState(false);
  const [completedSessions, setCompletedSessions] = useState(0);
  const [ambientSound, setAmbientSound] = useState("none");
  const [volume, setVolume] = useState(0.3);
  const [breakActivityDone, setBreakActivityDone] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const soundNodesRef = useRef<AmbientSoundNodes | null>(null);
  const workerRef   = useRef<Worker | null>(null);
  const startTimeRef = useRef<Date | null>(null);

  // Adapt timings based on energy level
  const config = useMemo(() => ({
    focus: energyLevel === "low" ? 15 * 60 : energyLevel === "hyperfocus" ? 50 * 60 : 25 * 60,
    shortBreak: energyLevel === "low" ? 5 * 60 : 5 * 60,
    longBreak: 15 * 60,
    sessionsBeforeLong: 4,
  }), [energyLevel]);

  // Sync timeLeft when energyLevel changes while timer is NOT running
  useEffect(() => {
    if (!isRunning) {
      setTimeLeft(config.focus);
      setPhase("focus");
    }
  }, [config.focus, isRunning]);

  const phaseDuration = useCallback(() => {
    switch (phase) {
      case "focus": return config.focus;
      case "short_break": return config.shortBreak;
      case "long_break": return config.longBreak;
    }
  }, [phase, config]);

  const phaseLabel: Record<TimerPhase, string> = {
    focus: "Focus",
    short_break: "Pausa breve",
    long_break: "Pausa lunga",
  };

  // Web Worker timer — preciso anche su mobile con schermo spento
  useEffect(() => {
    if (isRunning) {
      // Crea o riusa il worker
      if (!workerRef.current) {
        workerRef.current = createTimerWorker();
      }
      const worker = workerRef.current;

      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data as { type: string; secondsLeft?: number };
        if (msg.type === "TICK") {
          setTimeLeft(msg.secondsLeft ?? 0);
        } else if (msg.type === "DONE") {
          handlePhaseEnd();
        }
      };

      worker.postMessage({ type: "START", initialSeconds: timeLeft });
    } else {
      // Pausa: ferma il worker ma non lo distrugge
      workerRef.current?.postMessage({ type: "PAUSE" });
    }
    return () => {
      workerRef.current?.postMessage({ type: "PAUSE" });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRunning]);

  // Ambient sound effect
  useEffect(() => {
    // Clean up previous
    if (soundNodesRef.current) {
      try { soundNodesRef.current.source.stop(); } catch {}
      soundNodesRef.current = null;
    }

    if (ambientSound !== "none" && isRunning) {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume();
      }
      soundNodesRef.current = createAmbientSound(ambientSound, audioCtxRef.current, volume);
    }

    return () => {
      if (soundNodesRef.current) {
        try { soundNodesRef.current.source.stop(); } catch {}
        soundNodesRef.current = null;
      }
    };
  }, [ambientSound, isRunning, volume]);

  // Live volume adjustment
  useEffect(() => {
    if (soundNodesRef.current) {
      soundNodesRef.current.gain.gain.value = volume;
    }
  }, [volume]);

  const handlePhaseEnd = async () => {
    setIsRunning(false);

    if (phase === "focus") {
      const newCompleted = completedSessions + 1;
      setCompletedSessions(newCompleted);

      // Save focus session
      if (user) {
        await supabase.from("focus_sessions").insert({
          user_id: user.id,
          duration_minutes: Math.round(config.focus / 60),
          session_type: "pomodoro",
          completed: true,
          started_at: startTimeRef.current?.toISOString() || new Date().toISOString(),
          ended_at: new Date().toISOString(),
        });
        
        const focusXp = Math.round(config.focus / 60) * 2; // 2 XP per minute
        await awardUserXp({
          userId: user.id,
          amount: focusXp,
          source: "focus_session",
          sourceId: startTimeRef.current?.toISOString() ?? `${Date.now()}`,
        });
      }

      // Adaptive: after 4 sessions, long break
      if (newCompleted % config.sessionsBeforeLong === 0) {
        setPhase("long_break");
        setTimeLeft(config.longBreak);
      } else {
        setPhase("short_break");
        setTimeLeft(config.shortBreak);
      }
      setBreakActivityDone(false);
    } else {
      // Returning from break — award bonus XP if activity was done
      if (breakActivityDone && user) {
        await awardUserXp({
          userId: user.id,
          amount: 20,
          source: "dopamine_break_bonus",
          sourceId: `${Date.now()}`,
        });
        toast({
          title: "🎉 +20 XP Bonus!",
          description: "Sei tornato in tempo dalla pausa. Ottimo lavoro!",
        });
      }
      setPhase("focus");
      setTimeLeft(config.focus);
    }
  };

  const toggleTimer = () => {
    if (!isRunning) {
      startTimeRef.current = new Date();
    }
    setIsRunning(!isRunning);
  };

  const resetTimer = () => {
    setIsRunning(false);
    setPhase("focus");
    setTimeLeft(config.focus);
  };

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const progress = 1 - timeLeft / phaseDuration();

  // FIX: Close AudioContext + terminate Web Worker when component unmounts
  useEffect(() => {
    return () => {
      if (soundNodesRef.current) {
        try { soundNodesRef.current.source.stop(); } catch {}
        soundNodesRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  return (
    <div className="bg-card rounded-xl border border-border shadow-card p-6">
      <div className="flex items-center gap-2 mb-6">
        <Timer className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold text-card-foreground">Pomodoro Timer</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {completedSessions} sessioni completate
        </span>
      </div>

      {/* Phase tabs */}
      <div className="flex gap-1 bg-secondary rounded-lg p-1 mb-6">
        {(["focus", "short_break", "long_break"] as TimerPhase[]).map((p) => (
          <button
            key={p}
            onClick={() => {
              if (!isRunning) {
                setPhase(p);
                setTimeLeft(
                  p === "focus" ? config.focus :
                  p === "short_break" ? config.shortBreak :
                  config.longBreak
                );
              }
            }}
            className={`flex-1 text-xs font-medium py-2 rounded-md transition-all ${
              phase === p
                ? "bg-primary text-primary-foreground shadow-soft"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {phaseLabel[p]}
          </button>
        ))}
      </div>

      {/* Timer display */}
      <div className="relative flex flex-col items-center mb-6">
        <svg className="w-40 h-40" viewBox="0 0 100 100">
          <circle
            cx="50" cy="50" r="45"
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth="4"
          />
          <circle
            cx="50" cy="50" r="45"
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 45}`}
            strokeDashoffset={`${2 * Math.PI * 45 * (1 - progress)}`}
            transform="rotate(-90 50 50)"
            className="transition-all duration-1000"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-4xl font-bold font-display text-card-foreground tabular-nums">
            {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3 mb-6">
        <Button variant="outline" size="icon" onClick={resetTimer} aria-label="Reset">
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button size="lg" onClick={toggleTimer} className="px-8">
          {isRunning ? (
            <><Pause className="h-4 w-4 mr-2" /> Pausa</>
          ) : (
            <><Play className="h-4 w-4 mr-2" /> {timeLeft === phaseDuration() ? "Inizia" : "Riprendi"}</>
          )}
        </Button>
      </div>

      {/* Ambient sounds */}
      <div>
        <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
          {ambientSound !== "none" ? (
            <Volume2 className="h-3.5 w-3.5" />
          ) : (
            <VolumeX className="h-3.5 w-3.5" />
          )}
          Suoni ambientali
        </p>
        <div className="flex gap-2 flex-wrap mb-3">
          {AMBIENT_SOUNDS.map((s) => (
            <button
              key={s.id}
              onClick={() => setAmbientSound(s.id)}
              className={`text-xs px-3 py-1.5 rounded-full transition-all ${
                ambientSound === s.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.emoji} {s.label}
            </button>
          ))}
        </div>
        {ambientSound !== "none" && (
          <div className="flex items-center gap-3">
            <VolumeX className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Slider
              value={[volume]}
              onValueChange={([v]) => setVolume(v)}
              min={0}
              max={1}
              step={0.05}
              className="flex-1"
            />
            <Volume2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-[10px] text-muted-foreground w-8 text-right">{Math.round(volume * 100)}%</span>
          </div>
        )}
      </div>

      {/* Dopamine Break during break phases */}
      {phase !== "focus" && (
        <DopamineBreak onActivityDone={() => setBreakActivityDone(true)} />
      )}
    </div>
  );
};

export default PomodoroTimer;
