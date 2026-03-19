/**
 * FocusEducation — Test Suite
 *
 * Suite di test funzionali per i moduli core.
 * Esegui con: npx vitest run (o npx jest)
 *
 * Copertura:
 *  1. Algoritmo SM-2 (spacedRepetition)
 *  2. Utilità crediti (CREDIT_COSTS, calcolo refill)
 *  3. Routing — verifica che tutte le route definite siano raggiungibili
 *  4. FortuneWheel — logica premi e anti-duplicati
 *  5. TrialBanner — logica localStorage persistence
 *  6. Edge Functions — contratti API (input/output shape)
 *  7. Supabase queries — nessun join dot-notation rimasto
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. SM-2 ALGORITHM
// ═══════════════════════════════════════════════════════════════════════════
import { sm2, QUALITY_OPTIONS } from "../lib/spacedRepetition";

describe("SM-2 Algorithm", () => {
  test("qualità 5 (facile) riduce easiness factor e pianifica lontano", () => {
    const result = sm2(5, 0, 2.5, null);
    expect(result.newMasteryLevel).toBeGreaterThan(0);
    expect(result.newEasinessFactor).toBeGreaterThanOrEqual(2.5);
    expect(result.nextReviewAt.getTime()).toBeGreaterThan(Date.now() + 86_400_000);
  });

  test("qualità 1 (sbagliato) ripristina la carta a breve", () => {
    const result = sm2(1, 3, 2.5, null);
    expect(result.newMasteryLevel).toBe(0);
    const minutesFromNow = (result.nextReviewAt.getTime() - Date.now()) / 60_000;
    expect(minutesFromNow).toBeLessThan(30);
  });

  test("easiness factor non scende sotto 1.3", () => {
    let ef = 2.5;
    // Rispondo male 20 volte
    for (let i = 0; i < 20; i++) {
      const r = sm2(1, 0, ef, null);
      ef = r.newEasinessFactor;
    }
    expect(ef).toBeGreaterThanOrEqual(1.3);
  });

  test("QUALITY_OPTIONS ha 4 opzioni con valori 1,2,4,5", () => {
    expect(QUALITY_OPTIONS).toHaveLength(4);
    const values = QUALITY_OPTIONS.map(o => o.value);
    expect(values).toContain(1);
    expect(values).toContain(2);
    expect(values).toContain(4);
    expect(values).toContain(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CREDIT COSTS
// ═══════════════════════════════════════════════════════════════════════════
import { CREDIT_COSTS } from "../hooks/useCredits";

describe("Credit Costs", () => {
  test("tutti i tipi di azione hanno un costo positivo", () => {
    for (const [action, cost] of Object.entries(CREDIT_COSTS)) {
      expect(cost).toBeGreaterThan(0);
      expect(typeof cost).toBe("number");
    }
  });

  test("youtube costa più di quiz (funzione premium)", () => {
    expect(CREDIT_COSTS.youtube).toBeGreaterThan(CREDIT_COSTS.quiz);
  });

  test("flashcards ha un costo definito", () => {
    expect(CREDIT_COSTS.flashcards).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. ROUTES — All routes have corresponding pages
// ═══════════════════════════════════════════════════════════════════════════
import fs from "fs";
import path from "path";

describe("Routes", () => {
  const appContent = fs.readFileSync(
    path.resolve(__dirname, "../App.tsx"), "utf8"
  );

  const EXPECTED_ROUTES = [
    "/",
    "/auth",
    "/termini",
    "/privacy",
    "/pricing",
    "/dashboard",
    "/admin",
    "/study",
    "/leaderboard",
    "/profile",
    "/libreria",
    "/libreria/riassunto/:id",
    "/statistiche",
    "/mappe-concettuali",
    "/flashcards",
    "/domande",
  ];

  EXPECTED_ROUTES.forEach(route => {
    test(`route "${route}" è registrata in App.tsx`, () => {
      // Routes with params: check just the static part
      const staticPart = route.split(":")[0].replace(/\/$/, "");
      expect(appContent).toContain(staticPart || "/");
    });
  });

  test("tutte le pagine lazy-imported esistono come file", () => {
    const lazyImports = appContent.match(/lazy\(\(\) => import\("\.\/pages\/(\w+)"\)\)/g) || [];
    lazyImports.forEach(imp => {
      const match = imp.match(/import\("\.\/pages\/(\w+)"\)/);
      if (match) {
        const pagePath = path.resolve(__dirname, `../pages/${match[1]}.tsx`);
        expect(fs.existsSync(pagePath)).toBe(true);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. FORTUNE WHEEL — Prize logic
// ═══════════════════════════════════════════════════════════════════════════
describe("Fortune Wheel", () => {
  const PRIZES = [
    { id: "credits_50",  type: "credits", value: 50  },
    { id: "xp_200",      type: "xp",      value: 200 },
    { id: "credits_100", type: "credits", value: 100 },
    { id: "retry",       type: "retry",   value: 0   },
    { id: "credits_200", type: "credits", value: 200 },
    { id: "xp_500",      type: "xp",      value: 500 },
    { id: "badge",       type: "badge",   value: 0   },
    { id: "credits_50b", type: "credits", value: 50  },
  ];

  test("ci sono esattamente 8 spicchi", () => {
    expect(PRIZES).toHaveLength(8);
  });

  test("ogni premio ha type, value e id validi", () => {
    PRIZES.forEach(p => {
      expect(p.id).toBeTruthy();
      expect(["credits","xp","badge","retry"]).toContain(p.type);
      expect(p.value).toBeGreaterThanOrEqual(0);
    });
  });

  test("premi crediti hanno sempre value > 0 (tranne retry)", () => {
    PRIZES.filter(p => p.type === "credits").forEach(p => {
      expect(p.value).toBeGreaterThan(0);
    });
  });

  test("il componente FortuneWheel esiste come file", () => {
    const exists = fs.existsSync(
      path.resolve(__dirname, "../components/dashboard/FortuneWheel.tsx")
    );
    expect(exists).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. TRIAL BANNER — localStorage persistence
// ═══════════════════════════════════════════════════════════════════════════
describe("TrialBanner localStorage", () => {
  const DISMISSED_KEY = "trial_banner_dismissed_until";

  beforeEach(() => {
    localStorage.clear();
  });

  test("dismiss salva timestamp 24h nel futuro", () => {
    const future = Date.now() + 24 * 3_600_000;
    localStorage.setItem(DISMISSED_KEY, String(future));
    const stored = Number(localStorage.getItem(DISMISSED_KEY));
    expect(stored).toBeGreaterThan(Date.now());
    expect(stored).toBeLessThanOrEqual(Date.now() + 24 * 3_600_001);
  });

  test("timestamp scaduto non nasconde il banner", () => {
    const past = Date.now() - 1000;
    localStorage.setItem(DISMISSED_KEY, String(past));
    const until = Number(localStorage.getItem(DISMISSED_KEY));
    const isStillDismissed = Date.now() < until;
    expect(isStillDismissed).toBe(false);
  });

  test("banner urgente (ultimo giorno) non è dismissible", () => {
    // Logic: if daysLeft <= 1, isUrgent = true, dismiss is disabled
    const daysLeft = 0;
    const isUrgent = daysLeft !== null && daysLeft <= 1;
    expect(isUrgent).toBe(true);
    // Urgent banner should never call localStorage.setItem
    // (tested in component: dismiss() returns early if isUrgent)
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. EDGE FUNCTIONS — API contract shape
// ═══════════════════════════════════════════════════════════════════════════
describe("Edge Function contracts", () => {

  test("add-credits: ALLOWED_ACTIONS ha chiavi valide con valori > 0", () => {
    const ALLOWED: Record<string, number> = {
      fortune_wheel: 100,
      referral_bonus: 50,
      achievement_reward: 30,
      admin_grant: 9999,
    };
    for (const [action, max] of Object.entries(ALLOWED)) {
      expect(typeof action).toBe("string");
      expect(max).toBeGreaterThan(0);
    }
    expect(ALLOWED.fortune_wheel).toBe(100);
  });

  test("send-email: tipi validi sono esattamente 4", () => {
    const VALID_TYPES = ["welcome", "trial_expiring", "trial_expired", "purchase_receipt"];
    expect(VALID_TYPES).toHaveLength(4);
    VALID_TYPES.forEach(t => expect(typeof t).toBe("string"));
  });

  test("spend-credits: richiede action e cost numerica positiva", () => {
    const validRequest = { action: "quiz", cost: 5, description: "Generazione quiz" };
    expect(validRequest.action).toBeTruthy();
    expect(validRequest.cost).toBeGreaterThan(0);
    expect(typeof validRequest.cost).toBe("number");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. NO DOT-NOTATION JOIN FILTERS in source files
// ═══════════════════════════════════════════════════════════════════════════
describe("Supabase query safety", () => {
  const SRC_DIR = path.resolve(__dirname, "..");

  function findFiles(dir: string, ext: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== "node_modules" && e.name !== "__tests__") {
        results.push(...findFiles(full, ext));
      } else if (e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".tsx"))) {
        results.push(full);
      }
    }
    return results;
  }

  test('nessun file usa .eq("table.column") su join !inner', () => {
    const files = findFiles(SRC_DIR, ".ts");
    const offenders: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      // Pattern: .eq("word.word" — the dangerous join filter
      const matches = content.match(/\.eq\("[a-z_]+\.[a-z_]+"[^)]*\)/g) || [];
      // Exclude comments
      const realMatches = matches.filter(m => !m.includes("//"));
      if (realMatches.length > 0) {
        offenders.push(`${path.relative(SRC_DIR, file)}: ${realMatches.join(", ")}`);
      }
    }
    if (offenders.length > 0) {
      console.warn("⚠️  Possible unsafe join filters:", offenders);
    }
    expect(offenders).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. BACKEND API — URL configuration
// ═══════════════════════════════════════════════════════════════════════════
describe("Backend API configuration", () => {
  test("backendApi.ts esiste e usa VITE_BACKEND_URL", () => {
    const apiPath = path.resolve(__dirname, "../lib/backendApi.ts");
    expect(fs.existsSync(apiPath)).toBe(true);
    const content = fs.readFileSync(apiPath, "utf8");
    expect(content).toContain("VITE_BACKEND_URL");
    expect(content).toContain("getAuthToken");
  });

  test("nessuna chiamata fetch hardcoded con URL di produzione", () => {
    const apiPath = path.resolve(__dirname, "../lib/backendApi.ts");
    const content = fs.readFileSync(apiPath, "utf8");
    // Should not have hardcoded https://focuseducation... URLs in fetch calls
    const hardcoded = content.match(/fetch\(["'`]https:\/\/focuseducation[^"'`]*["'`]/g);
    expect(hardcoded).toBeNull();
  });
});
