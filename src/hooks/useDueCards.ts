import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface DueCard {
  id:              string;
  front:           string;
  back:            string;
  topic:           string | null;
  mastery_level:   number;
  easiness_factor: number;
  next_review_at:  string | null;
  deck_id:         string;
  deck_title:      string;
}

export function useDueCards() {
  const { user }                = useAuth();
  const [dueCount, setDueCount] = useState(0);
  const [loading, setLoading]   = useState(true);

  const refresh = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    try {
      const { data, error } = await supabase.rpc("count_due_cards", {
        _user_id: user.id,
      });
      if (!error && typeof data === "number") setDueCount(data);
    } catch (e) {
      console.error("[useDueCards]", e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  // deckId: optional filter — if provided, loads only due cards from that deck
  const loadDueCards = useCallback(async (limit = 20, deckId?: string): Promise<DueCard[]> => {
    if (!user) return [];

    if (deckId) {
      // Direct query for a specific deck — no RPC needed
      const { data, error } = await supabase
        .from("flashcards")
        .select("id,front,back,topic,deck_id,mastery_level,easiness_factor,next_review_at, flashcard_decks!inner(title)")
        .eq("deck_id", deckId)
        .or(`next_review_at.is.null,next_review_at.lte.${new Date().toISOString()}`)
        .order("easiness_factor", { ascending: true })
        .limit(limit);

      if (error || !data) return [];
      return (data as any[]).map(row => ({
        id: row.id, front: row.front, back: row.back, topic: row.topic,
        mastery_level: row.mastery_level, easiness_factor: row.easiness_factor ?? 2.5,
        next_review_at: row.next_review_at, deck_id: row.deck_id,
        deck_title: row.flashcard_decks?.title ?? "Deck",
      }));
    }

    const { data, error } = await supabase.rpc("get_due_cards", {
      _user_id: user.id,
      _limit:   limit,
    });

    if (error || !data) {
      console.error("[useDueCards] get_due_cards RPC error:", error);
      return [];
    }

    return (data as any[]).map((row) => ({
      id:              row.id,
      front:           row.front,
      back:            row.back,
      topic:           row.topic,
      mastery_level:   row.mastery_level,
      easiness_factor: row.easiness_factor ?? 2.5,
      next_review_at:  row.next_review_at,
      deck_id:         row.deck_id,
      deck_title:      row.deck_title ?? "Deck",
    }));
  }, [user]);

  return { dueCount, loading, refresh, loadDueCards };
}
