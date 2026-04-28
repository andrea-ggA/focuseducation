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

interface DueCardRow {
  id: string;
  front: string;
  back: string;
  topic: string | null;
  mastery_level: number;
  easiness_factor: number | null;
  next_review_at: string | null;
  deck_id: string;
  deck_title?: string | null;
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
      const { data, error } = await supabase.rpc("get_due_cards_for_deck", {
        _deck_id: deckId,
        _limit: limit,
      });

      if (error || !data) return [];
      return (data as DueCardRow[]).map(row => ({
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

    return (data as DueCardRow[]).map((row) => ({
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
