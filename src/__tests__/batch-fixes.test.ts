import fs from "fs";
import path from "path";
import { describe, expect, test } from "vitest";
import { sm2 } from "../lib/spacedRepetition";
import { getLocalDateString, getStartOfLocalDay, getStartOfLocalWeek } from "../lib/datetime";

describe("Batch fixes", () => {
  test("SM-2 blackout enters relearning instead of instant due", () => {
    const result = sm2(0, 3, 2.5);
    const minutesFromNow = (result.nextReviewAt.getTime() - Date.now()) / 60_000;
    expect(result.newMasteryLevel).toBe(0);
    expect(minutesFromNow).toBeGreaterThanOrEqual(9);
    expect(minutesFromNow).toBeLessThan(30);
  });

  test("local datetime helpers keep local calendar boundaries", () => {
    const sample = new Date("2026-04-23T15:45:30");
    expect(getLocalDateString(sample)).toBe("2026-04-23");
    expect(getStartOfLocalDay(sample).getHours()).toBe(0);
    expect(getStartOfLocalDay(sample).getMinutes()).toBe(0);

    const monday = getStartOfLocalWeek(new Date("2026-04-23T15:45:30"));
    expect(monday.getDay()).toBe(1);
    expect(monday.getHours()).toBe(0);
  });

  test("SummaryDetail uses shared tutor transport and refund path", () => {
    const file = fs.readFileSync(
      path.resolve(__dirname, "../pages/SummaryDetail.tsx"),
      "utf8",
    );
    expect(file).toContain('streamTutorChat(newMessages, token, markdown)');
    expect(file).toContain('addCredits(CREDIT_COSTS.tutor, "tutor_refund"');
    expect(file).not.toContain('/functions/v1/ai-tutor');
  });

  test("FocusBurst waits for explicit start and records flashcard reviews", () => {
    const file = fs.readFileSync(
      path.resolve(__dirname, "../components/study/FocusBurst.tsx"),
      "utf8",
    );
    expect(file).toContain("if (!started || loading || done) return;");
    expect(file).toContain("await recordFlashcardReview({");
    expect(file).toContain("if (!started) return (");
  });
});
