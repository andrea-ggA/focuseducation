import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";

const XP_PER_LEVEL = 500;
const xpWriteQueues = new Map<string, Promise<unknown>>();
const flashcardWriteQueues = new Map<string, Promise<unknown>>();

function toSafeInt(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.round(value);
}

function computeLevel(totalXp: number): number {
  return Math.floor(Math.max(0, toSafeInt(totalXp)) / XP_PER_LEVEL) + 1;
}

function queueUserWrite<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const previous = xpWriteQueues.get(userId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  xpWriteQueues.set(
    userId,
    next.finally(() => {
      if (xpWriteQueues.get(userId) === next) {
        xpWriteQueues.delete(userId);
      }
    }),
  );
  return next;
}

function queueFlashcardWrite<T>(cardId: string, task: () => Promise<T>): Promise<T> {
  const previous = flashcardWriteQueues.get(cardId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  flashcardWriteQueues.set(
    cardId,
    next.finally(() => {
      if (flashcardWriteQueues.get(cardId) === next) {
        flashcardWriteQueues.delete(cardId);
      }
    }),
  );
  return next;
}

export interface AwardUserXpInput {
  userId: string;
  amount: number;
  source: string;
  sourceId?: string | null;
  dedupeBySourceId?: boolean;
  quizzesCompletedDelta?: number;
  perfectScoresDelta?: number;
}

export interface AwardUserXpResult {
  applied: boolean;
  totalXp: number;
  level: number;
}

export async function awardUserXp({
  userId,
  amount,
  source,
  sourceId = null,
  dedupeBySourceId = false,
  quizzesCompletedDelta = 0,
  perfectScoresDelta = 0,
}: AwardUserXpInput): Promise<AwardUserXpResult> {
  return queueUserWrite(userId, async () => {
    const xpDelta = toSafeInt(amount);
    const quizDelta = Math.max(0, toSafeInt(quizzesCompletedDelta));
    const perfectDelta = Math.max(0, toSafeInt(perfectScoresDelta));
    const shouldDedupeBySource = Boolean(dedupeBySourceId && sourceId && xpDelta !== 0);
    let dedupeLogInserted = false;

    if (shouldDedupeBySource) {
      const { data: insertedLog, error: dedupeLogError } = await supabase
        .from("xp_log")
        .upsert(
          {
            user_id: userId,
            source,
            source_id: sourceId,
            xp_amount: xpDelta,
          },
          {
            onConflict: "user_id,source,source_id",
            ignoreDuplicates: true,
          },
        )
        .select("id")
        .maybeSingle();

      if (dedupeLogError) throw dedupeLogError;
      if (!insertedLog) {
        const { data: existing, error: currentError } = await supabase
          .from("user_xp")
          .select("total_xp")
          .eq("user_id", userId)
          .maybeSingle();
        if (currentError) throw currentError;
        const totalXp = existing?.total_xp ?? 0;
        return { applied: false, totalXp, level: computeLevel(totalXp) };
      }

      dedupeLogInserted = true;
    }

    const { data: current, error: currentError } = await supabase
      .from("user_xp")
      .select("total_xp, quizzes_completed, perfect_scores")
      .eq("user_id", userId)
      .maybeSingle();
    if (currentError) throw currentError;

    const prevTotalXp = current?.total_xp ?? 0;
    const nextTotalXp = Math.max(0, prevTotalXp + xpDelta);
    const nextLevel = computeLevel(nextTotalXp);
    const nextQuizCount = (current?.quizzes_completed ?? 0) + quizDelta;
    const nextPerfectScores = (current?.perfect_scores ?? 0) + perfectDelta;

    if (current) {
      const { error: updateError } = await supabase
        .from("user_xp")
        .update({
          total_xp: nextTotalXp,
          level: nextLevel,
          quizzes_completed: nextQuizCount,
          perfect_scores: nextPerfectScores,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
      if (updateError) throw updateError;
    } else {
      const payload: TablesInsert<"user_xp"> = {
        user_id: userId,
        total_xp: nextTotalXp,
        level: nextLevel,
        quizzes_completed: nextQuizCount,
        perfect_scores: nextPerfectScores,
      };
      const { error: upsertError } = await supabase
        .from("user_xp")
        .upsert(payload, { onConflict: "user_id" });
      if (upsertError) throw upsertError;
    }

    if (xpDelta !== 0 && !dedupeLogInserted) {
      const { error: logInsertError } = await supabase.from("xp_log").insert({
        user_id: userId,
        source,
        source_id: sourceId,
        xp_amount: xpDelta,
      });
      if (logInsertError) throw logInsertError;
    }

    return { applied: true, totalXp: nextTotalXp, level: nextLevel };
  });
}

export interface RecordQuestionProgressInput {
  userId: string;
  quizId: string;
  questionId: string;
  selectedAnswer: number;
  isCorrect: boolean;
  timeTakenSeconds?: number | null;
}

export async function recordQuestionProgress({
  userId,
  quizId,
  questionId,
  selectedAnswer,
  isCorrect,
  timeTakenSeconds = null,
}: RecordQuestionProgressInput): Promise<void> {
  const normalizedAnswer = toSafeInt(selectedAnswer, -1);
  const normalizedTime = timeTakenSeconds === null ? null : Math.max(0, toSafeInt(timeTakenSeconds));

  const payload: TablesInsert<"user_question_progress"> = {
    user_id: userId,
    quiz_id: quizId,
    question_id: questionId,
    selected_answer: normalizedAnswer,
    is_correct: Boolean(isCorrect),
    time_taken_seconds: normalizedTime,
  };

  const { error } = await supabase.from("user_question_progress").insert(payload);
  if (error) throw error;
}

export interface RecordQuizAttemptInput {
  userId: string;
  quizId: string;
  score: number;
  totalPoints: number;
  correctAnswers: number;
  totalAnswered: number;
  timeTakenSeconds?: number | null;
  xpEarned?: number;
  xpBet?: number | null;
}

export async function recordQuizAttempt({
  userId,
  quizId,
  score,
  totalPoints,
  correctAnswers,
  totalAnswered,
  timeTakenSeconds = null,
  xpEarned = 0,
  xpBet = null,
}: RecordQuizAttemptInput): Promise<void> {
  const payload: TablesInsert<"quiz_attempts"> = {
    user_id: userId,
    quiz_id: quizId,
    score: Math.max(0, toSafeInt(score)),
    total_points: Math.max(0, toSafeInt(totalPoints)),
    correct_answers: Math.max(0, toSafeInt(correctAnswers)),
    total_answered: Math.max(0, toSafeInt(totalAnswered)),
    time_taken_seconds: timeTakenSeconds === null ? null : Math.max(0, toSafeInt(timeTakenSeconds)),
    xp_earned: toSafeInt(xpEarned),
    xp_bet: xpBet === null ? null : toSafeInt(xpBet),
  };

  const { error } = await supabase.from("quiz_attempts").insert(payload);
  if (error) throw error;
}

export interface RecordFlashcardReviewInput {
  userId: string;
  cardId: string;
  deckId: string;
  quality: number;
  masteryLevel: number;
  easinessFactor: number;
  nextReviewAt: string | Date;
}

export async function recordFlashcardReview({
  userId,
  cardId,
  deckId,
  quality,
  masteryLevel,
  easinessFactor,
  nextReviewAt,
}: RecordFlashcardReviewInput): Promise<void> {
  const nextReviewIso = nextReviewAt instanceof Date ? nextReviewAt.toISOString() : new Date(nextReviewAt).toISOString();
  const normalizedQuality = Math.max(0, Math.min(5, toSafeInt(quality, 0)));

  await queueFlashcardWrite(cardId, async () => {
    const { error: updateError } = await supabase
      .from("flashcards")
      .update({
        mastery_level: Math.max(0, toSafeInt(masteryLevel, 0)),
        easiness_factor: Math.max(1.3, Number.isFinite(easinessFactor) ? easinessFactor : 2.5),
        next_review_at: nextReviewIso,
      })
      .eq("id", cardId);

    if (updateError) throw updateError;

    const { error: reviewInsertError } = await supabase.from("flashcard_reviews").insert({
      user_id: userId,
      card_id: cardId,
      deck_id: deckId,
      quality: normalizedQuality,
    });

    if (reviewInsertError) throw reviewInsertError;
  });
}
