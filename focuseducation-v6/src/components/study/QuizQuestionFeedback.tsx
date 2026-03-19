import { useState, useEffect } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface QuizQuestionFeedbackProps {
  questionId: string;
}

export default function QuizQuestionFeedback({ questionId }: QuizQuestionFeedbackProps) {
  const { user }              = useAuth();
  const { toast }             = useToast();
  const [rating, setRating]   = useState<-1 | 1 | null>(null);
  const [loading, setLoading] = useState(false);

  // Load existing feedback
  useEffect(() => {
    if (!user) return;
    supabase
      .from("quiz_question_feedback")
      .select("rating")
      .eq("user_id", user.id)
      .eq("question_id", questionId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setRating(data.rating as -1 | 1);
      });
  }, [user, questionId]);

  const vote = async (value: -1 | 1) => {
    if (!user || loading) return;
    const newRating = rating === value ? null : value;
    setRating(newRating);
    setLoading(true);

    try {
      if (newRating === null) {
        await supabase
          .from("quiz_question_feedback")
          .delete()
          .eq("user_id", user.id)
          .eq("question_id", questionId);
      } else {
        await supabase
          .from("quiz_question_feedback")
          .upsert({
            user_id:     user.id,
            question_id: questionId,
            rating:      newRating,
          });
      }

      if (value === -1 && newRating === -1) {
        toast({
          title:       "Feedback ricevuto",
          description: "Grazie! Le domande segnalate vengono usate per migliorare i quiz.",
        });
      }
    } catch (e) {
      console.error("[QuestionFeedback]", e);
      setRating(rating); // revert
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5" title="Feedback sulla domanda">
      <button
        onClick={() => vote(1)}
        disabled={loading}
        className={`p-1.5 rounded-md transition-colors ${
          rating === 1
            ? "text-primary bg-primary/10"
            : "text-muted-foreground hover:text-primary hover:bg-primary/10"
        }`}
        aria-label="Domanda utile"
      >
        <ThumbsUp className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => vote(-1)}
        disabled={loading}
        className={`p-1.5 rounded-md transition-colors ${
          rating === -1
            ? "text-destructive bg-destructive/10"
            : "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        }`}
        aria-label="Domanda da migliorare"
      >
        <ThumbsDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
