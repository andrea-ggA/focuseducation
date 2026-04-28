import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Clock, Sparkles, CheckCircle2, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { awardUserXp } from "@/lib/progression";

interface MicroTask {
  id: string;
  title: string;
  description: string | null;
  completed: boolean;
  estimated_minutes: number | null;
  priority: string;
}

interface ParentTask {
  id: string;
  title: string;
  description: string | null;
  estimated_minutes: number | null;
  children: MicroTask[];
}

const MicroTaskList = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [parents, setParents] = useState<ParentTask[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      // Get parent tasks that have children (decomposed tasks)
      const { data: allTasks } = await supabase
        .from("tasks")
        .select("id, title, description, completed, estimated_minutes, priority, parent_task_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (!allTasks) { setLoading(false); return; }

      const childMap = new Map<string, MicroTask[]>();
      const parentIds = new Set<string>();
      
      allTasks.forEach(t => {
        if (t.parent_task_id) {
          parentIds.add(t.parent_task_id);
          const arr = childMap.get(t.parent_task_id) || [];
          arr.push(t as MicroTask);
          childMap.set(t.parent_task_id, arr);
        }
      });

      const parentTasks: ParentTask[] = allTasks
        .filter(t => parentIds.has(t.id))
        .map(t => ({
          id: t.id,
          title: t.title,
          description: t.description,
          estimated_minutes: t.estimated_minutes,
          children: childMap.get(t.id) || [],
        }));

      setParents(parentTasks);
      if (parentTasks.length > 0) setExpanded(new Set([parentTasks[0].id]));
      setLoading(false);
    };
    fetch();
  }, [user]);

  const toggleTask = async (taskId: string, parentId: string, currentCompleted: boolean) => {
    const newCompleted = !currentCompleted;
    setParents(prev => prev.map(p =>
      p.id === parentId
        ? { ...p, children: p.children.map(c => c.id === taskId ? { ...c, completed: newCompleted } : c) }
        : p
    ));

    await supabase.from("tasks").update({ completed: newCompleted }).eq("id", taskId);

    // Award +5 XP when completing a micro-task
    if (newCompleted && user) {
      await awardUserXp({
        userId: user.id,
        amount: 5,
        source: "micro_task",
        sourceId: taskId,
        dedupeBySourceId: true,
      });
      toast({ title: "+5 XP! ✨", description: "Micro-task completato!" });
    }
  };

  const deleteParent = async (parentId: string) => {
    await supabase.from("tasks").delete().eq("parent_task_id", parentId);
    await supabase.from("tasks").delete().eq("id", parentId);
    setParents(prev => prev.filter(p => p.id !== parentId));
    toast({ title: "Piano eliminato" });
  };

  if (loading) return null;
  if (parents.length === 0) return null;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-card-foreground flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary" />
        Piani di studio AI
      </h3>
      {parents.map(parent => {
        const isExpanded = expanded.has(parent.id);
        const completedCount = parent.children.filter(c => c.completed).length;
        const progress = parent.children.length > 0 ? Math.round((completedCount / parent.children.length) * 100) : 0;

        return (
          <div key={parent.id} className="border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => setExpanded(prev => {
                const next = new Set(prev);
                if (next.has(parent.id)) next.delete(parent.id);
                else next.add(parent.id);
                return next;
              })}
              className="w-full flex items-center gap-3 p-4 hover:bg-secondary/30 transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-card-foreground truncate">{parent.title}</p>
                <p className="text-xs text-muted-foreground">
                  {completedCount}/{parent.children.length} completati · {parent.estimated_minutes} min stimati
                </p>
              </div>
              <Badge variant={progress === 100 ? "default" : "secondary"} className="text-[10px] shrink-0">
                {progress}%
              </Badge>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                onClick={(e) => { e.stopPropagation(); deleteParent(parent.id); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </button>

            <AnimatePresence>
              {isExpanded && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="px-4 pb-4 space-y-1.5">
                    {parent.children.map((task) => (
                      <div key={task.id} className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${task.completed ? "bg-primary/5" : "hover:bg-secondary/50"}`}>
                        <Checkbox checked={task.completed} onCheckedChange={() => toggleTask(task.id, parent.id, task.completed)} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${task.completed ? "line-through text-muted-foreground" : "text-card-foreground"}`}>{task.title}</p>
                          {task.description && <p className="text-[10px] text-muted-foreground truncate">{task.description}</p>}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                          <Clock className="h-3 w-3" />
                          {task.estimated_minutes} min
                        </div>
                        {task.completed && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
};

export default MicroTaskList;
