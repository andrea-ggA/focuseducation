import { useState, useEffect, useRef, forwardRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Brain, ArrowLeft, Loader2, Eye, EyeOff, Mail, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import LanguageSelector from "@/components/LanguageSelector";
import { useAuth } from "@/contexts/AuthContext";
import { normalizeReferralCode } from "@/lib/security";

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const GoogleIcon = forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>((props, ref) => (
  <svg ref={ref} viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" {...props}>
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
));

GoogleIcon.displayName = "GoogleIcon";

type AuthView = "login" | "register" | "forgot";

const GOOGLE_TIMEOUT_MS = 15_000; // 15s — reset loader if redirect never happens
const Auth = () => {
  const { t }        = useTranslation();
  const { session, loading: authLoading } = useAuth();
  const [view, setView]                 = useState<AuthView>("login");
  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fullName, setFullName]         = useState("");
  const [loading, setLoading]           = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError]   = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [newsletter, setNewsletter]     = useState(true);
  const [referralCode, setReferralCode] = useState("");
  const [resetSent, setResetSent]       = useState(false);
  const navigate                        = useNavigate();
  const { toast }                       = useToast();
  const googleTimeoutRef                = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Referral code from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const normalizedRef = normalizeReferralCode(params.get("ref"));
    if (normalizedRef) {
      setReferralCode(normalizedRef);
      setView("register");
    }
  }, []);

  // Redirect reactively as soon as auth state is ready.
  // This fixes the race where email/password login navigated before the
  // shared auth context had updated, bouncing the user back to /auth.
  useEffect(() => {
    if (authLoading || !session) return;

    if (googleTimeoutRef.current) {
      clearTimeout(googleTimeoutRef.current);
      googleTimeoutRef.current = null;
    }

    setGoogleLoading(false);
    setGoogleError(false);
    navigate("/dashboard", { replace: true });
  }, [authLoading, navigate, session]);

  // Cleanup timeout on unmount
  useEffect(() => () => {
    if (googleTimeoutRef.current) clearTimeout(googleTimeoutRef.current);
  }, []);

  // ─── Google OAuth ─────────────────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    setGoogleError(false);

    // Safety timeout: if the redirect never fires (popup blocked, network error,
    // Supabase misconfiguration) reset the button after 15s so user isn't stuck.
    googleTimeoutRef.current = setTimeout(() => {
      setGoogleLoading(false);
      setGoogleError(true);
    }, GOOGLE_TIMEOUT_MS);

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
          queryParams: {
            prompt: "select_account",
          },
        },
      });

      if (error) throw error;

      if (!data?.url) {
        setGoogleLoading(false);
      }
    } catch (err: unknown) {
      if (googleTimeoutRef.current) {
        clearTimeout(googleTimeoutRef.current);
        googleTimeoutRef.current = null;
      }
      setGoogleLoading(false);
      setGoogleError(true);
      toast({
        title:       "Errore accesso Google",
        description: getErrorMessage(err, "Impossibile connettersi a Google. Riprova o usa email/password."),
        variant:     "destructive",
      });
    }
  };

  // ─── Email/password ───────────────────────────────────────────────────────
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { toast({ title: t("auth.email"), variant: "destructive" }); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth`,
      });
      if (error) throw error;
      setResetSent(true);
    } catch (err: unknown) {
      toast({
        title: "Errore",
        description: getErrorMessage(err, "Impossibile inviare il reset password."),
        variant: "destructive",
      });
    } finally { setLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (view === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        if (password !== confirmPassword) {
          toast({ title: t("auth.passwordMismatch"), variant: "destructive" });
          return;
        }
        const { error, data: signUpData } = await supabase.auth.signUp({
          email, password,
          options: {
            data: { full_name: fullName, newsletter, referral_code: referralCode || undefined },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        const normalizedCode = normalizeReferralCode(referralCode);
        if (normalizedCode && signUpData.user) {
          localStorage.setItem("pending_referral_code", normalizedCode);
        }
        toast({ title: t("auth.checkEmail"), description: t("auth.confirmSent") });
      }
    } catch (err: unknown) {
      toast({
        title: "Errore",
        description: getErrorMessage(err, "Autenticazione non riuscita."),
        variant: "destructive",
      });
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="w-full max-w-md"
      >
        <div className="flex items-center justify-between mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" /> {t("auth.back")}
          </Link>
          <LanguageSelector />
        </div>

        <div className="bg-card rounded-2xl shadow-card p-8 border border-border">
          <div className="flex items-center gap-2 justify-center mb-6">
            <Brain className="h-8 w-8 text-primary" />
            <span className="font-display font-bold text-2xl text-card-foreground">FocusED</span>
          </div>

          <AnimatePresence mode="wait">
            {view === "forgot" ? (
              <motion.div key="forgot" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h1 className="text-xl font-bold text-center text-card-foreground mb-1">{t("auth.resetTitle")}</h1>
                <p className="text-sm text-muted-foreground text-center mb-6">{t("auth.resetSubtitle")}</p>

                {resetSent ? (
                  <div className="text-center space-y-4">
                    <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                      <Mail className="h-8 w-8 text-primary" />
                    </div>
                    <p className="text-sm text-card-foreground">{t("auth.resetSent")} <strong>{email}</strong>.</p>
                    <p className="text-xs text-muted-foreground">{t("auth.checkSpam")}</p>
                    <Button variant="outline" className="w-full" onClick={() => { setView("login"); setResetSent(false); }}>
                      {t("auth.backToLogin")}
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleForgotPassword} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="resetEmail">{t("auth.email")}</Label>
                      <Input id="resetEmail" type="email" placeholder={t("auth.emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} required />
                    </div>
                    <Button type="submit" className="w-full h-11" disabled={loading}>
                      {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {t("auth.sendReset")}
                    </Button>
                    <Button variant="ghost" className="w-full" type="button" onClick={() => setView("login")}>{t("auth.backToLogin")}</Button>
                  </form>
                )}
              </motion.div>
            ) : (
              <motion.div key="auth" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                <h1 className="text-xl font-bold text-center text-card-foreground mb-1">
                  {view === "login" ? t("auth.welcomeBack") : t("auth.createAccount")}
                </h1>
                <p className="text-sm text-muted-foreground text-center mb-6">
                  {view === "login" ? t("auth.loginSubtitle") : t("auth.registerSubtitle")}
                </p>

                {/* Google OAuth button */}
                <Button
                  type="button"
                  variant="outline"
                  className={`w-full h-12 text-sm font-medium gap-3 mb-1 ${googleError ? "border-destructive/50" : ""}`}
                  onClick={handleGoogleSignIn}
                  disabled={googleLoading}
                >
                  {googleLoading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : googleError
                    ? <RefreshCw className="h-4 w-4 text-destructive" />
                    : <GoogleIcon />}
                  {googleLoading
                    ? "Reindirizzamento a Google..."
                    : googleError
                    ? "Riprova con Google"
                    : t("auth.continueGoogle")}
                </Button>

                {/* Hint shown after timeout/error */}
                {googleError && (
                  <p className="text-xs text-muted-foreground text-center mb-3">
                    Se il problema persiste, usa email e password qui sotto.
                  </p>
                )}

                <div className="relative my-5">
                  <Separator />
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs text-muted-foreground">
                    {t("auth.orEmail")}
                  </span>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {view === "register" && (
                    <div className="space-y-2">
                      <Label htmlFor="fullName">{t("auth.fullName")}</Label>
                      <Input id="fullName" type="text" placeholder={t("auth.namePlaceholder")} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="email">{t("auth.email")}</Label>
                    <Input id="email" type="email" placeholder={t("auth.emailPlaceholder")} value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">{t("auth.password")}</Label>
                    <div className="relative">
                      <Input
                        id="password" type={showPassword ? "text" : "password"}
                        placeholder={t("auth.passwordMin")} value={password}
                        onChange={(e) => setPassword(e.target.value)} required minLength={6} className="pr-10"
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {view === "register" && (
                    <div className="space-y-2">
                      <Label htmlFor="confirmPassword">{t("auth.confirmPassword")}</Label>
                      <Input
                        id="confirmPassword" type={showPassword ? "text" : "password"}
                        placeholder={t("auth.repeatPassword")} value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6}
                      />
                      {confirmPassword && password !== confirmPassword && (
                        <p className="text-xs text-destructive">{t("auth.passwordMismatch")}</p>
                      )}
                    </div>
                  )}

                  {view === "register" && (
                    <div className="space-y-2">
                      <Label htmlFor="referralCode">
                        Codice Referral <span className="text-muted-foreground font-normal">(opzionale)</span>
                      </Label>
                      <Input
                        id="referralCode" type="text" placeholder="es. FOCUSED-ABC123"
                        value={referralCode} onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                        className="font-mono"
                      />
                    </div>
                  )}

                  {view === "login" && (
                    <button type="button" onClick={() => setView("forgot")} className="text-xs text-primary hover:underline">
                      {t("auth.forgotPassword")}
                    </button>
                  )}

                  {view === "register" && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-ring" />
                      <span className="text-sm text-muted-foreground">{t("auth.newsletter")}</span>
                    </label>
                  )}

                  <Button
                    type="submit" className="w-full h-11"
                    disabled={loading || (view === "register" && password !== confirmPassword)}
                  >
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {view === "login" ? t("auth.login") : t("auth.register")}
                  </Button>
                </form>

                <p className="text-sm text-center text-muted-foreground mt-6">
                  {view === "login" ? t("auth.noAccount") : t("auth.hasAccount")}{" "}
                  <button type="button" onClick={() => setView(view === "login" ? "register" : "login")}
                    className="text-primary font-medium hover:underline">
                    {view === "login" ? t("auth.register") : t("auth.login")}
                  </button>
                </p>

                <p className="text-xs text-center text-muted-foreground mt-4">
                  {t("auth.termsText")}{" "}
                  <Link to="/termini" className="underline hover:text-foreground">{t("auth.termsLink")}</Link>{" "}
                  {t("auth.andThe")}{" "}
                  <Link to="/privacy" className="underline hover:text-foreground">{t("auth.privacyLink")}</Link>
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};

export default Auth;
