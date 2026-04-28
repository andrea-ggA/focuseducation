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

const RELEARNING_DELAY_MINUTES = 10;

function computeIntervalFromRepetition(repetitions: number, easinessFactor: number): number {
  if (repetitions <= 1) return 1;
  if (repetitions === 2) return 6;

  let interval = 6;
  for (let i = 3; i <= repetitions; i += 1) {
    interval = Math.max(interval + 1, Math.round(interval * easinessFactor));
  }
  return interval;
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
): SM2Result {
  const now = new Date();

  // Update EF using Wozniak 1987 formula
  const newEF = Math.max(
    1.3,
    easinessFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );

  let newRepetitions: number;
  let nextReview: Date;

  if (quality < 3) {
    // Wrong answer: enter relearning with a short retry window instead of
    // making the card instantly due again.
    newRepetitions = 0;
    nextReview = new Date(
      now.getTime() + (quality === 0 ? RELEARNING_DELAY_MINUTES * 60_000 : 86_400_000),
    );
  } else {
    newRepetitions = repetitions + 1;
    const intervalDays = computeIntervalFromRepetition(newRepetitions, newEF);
    nextReview = new Date(now.getTime() + intervalDays * 86_400_000);
  }

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
