/**
 * SM-2 Spaced Repetition Algorithm (corrected implementation)
 *
 * Key fix: easiness_factor is now PERSISTED per-card and passed in/out.
 * Previously it was recalculated from scratch each time (always starting
 * at 2.5), which made hard cards converge to the same interval as easy ones.
 *
 * Quality ratings:
 * 0 = "Non la so"  (complete blackout)
 * 2 = "Difficile"  (recalled with serious difficulty)
 * 4 = "Bene"       (recalled with some hesitation)
 * 5 = "Facile"     (perfect recall)
 */

export interface SM2Result {
  newMasteryLevel:   number;
  newEasinessFactor: number;  // must be saved back to the flashcard row
  nextReviewAt:      Date;
}

/**
 * @param quality        0 | 2 | 4 | 5
 * @param repetitions    consecutive successful recalls (= mastery_level in DB)
 * @param easinessFactor current EF for this card (default 2.5 for new cards)
 * @param lastReviewAt   timestamp of previous review
 */
export function sm2(
  quality:        number,
  repetitions:    number,
  easinessFactor: number = 2.5,
  lastReviewAt?:  Date | null,
): SM2Result {
  const now = new Date();

  let previousIntervalDays = 1;
  if (lastReviewAt) {
    const diff = (now.getTime() - new Date(lastReviewAt).getTime()) / 86_400_000;
    previousIntervalDays = Math.max(1, Math.round(diff));
  }

  // Update EF using Wozniak 1987 formula
  const newEF = Math.max(
    1.3,
    easinessFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );

  let newRepetitions: number;
  let intervalDays:   number;

  if (quality < 3) {
    // Wrong answer: reset repetitions but keep (degraded) EF
    newRepetitions = 0;
    intervalDays   = quality === 0 ? 0 : 1;
  } else {
    newRepetitions = repetitions + 1;
    if (newRepetitions === 1)      intervalDays = 1;
    else if (newRepetitions === 2) intervalDays = 6;
    else                           intervalDays = Math.round(previousIntervalDays * newEF);
  }

  const nextReview = new Date(now.getTime() + intervalDays * 86_400_000);

  return {
    newMasteryLevel:   Math.min(newRepetitions, 5),
    newEasinessFactor: newEF,
    nextReviewAt:      nextReview,
  };
}

export function isDueForReview(nextReviewAt: string | null): boolean {
  if (!nextReviewAt) return true;
  return new Date(nextReviewAt) <= new Date();
}

export const QUALITY_OPTIONS = [
  { value: 0, label: "Non la so", emoji: "😵", color: "destructive" as const },
  { value: 2, label: "Difficile", emoji: "😓", color: "outline"     as const },
  { value: 4, label: "Bene",      emoji: "😊", color: "outline"     as const },
  { value: 5, label: "Facile!",   emoji: "🎯", color: "default"     as const },
] as const;
