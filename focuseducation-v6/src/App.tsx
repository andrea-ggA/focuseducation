import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import TrialExpiredModal from "@/components/dashboard/TrialExpiredModal";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AdminRoute from "@/components/AdminRoute";
import GenerationNotifier from "@/components/GenerationNotifier";
import ErrorBoundary from "@/components/ErrorBoundary";
import PageLoader from "@/components/PageLoader";
import { ThemeProvider } from "next-themes";

// Lazy-loaded pages
const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Admin = lazy(() => import("./pages/Admin"));
const Study = lazy(() => import("./pages/Study"));
const Profile = lazy(() => import("./pages/Profile"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const PricingPage = lazy(() => import("./pages/Pricing"));
const Library = lazy(() => import("./pages/Library"));
const Statistics = lazy(() => import("./pages/Statistics"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));
const SummaryDetail = lazy(() => import("./pages/SummaryDetail"));
const SharedQuiz = lazy(() => import("./pages/SharedQuiz"));
const SharedFlashcards = lazy(() => import("./pages/SharedFlashcards"));
const SharedSummary = lazy(() => import("./pages/SharedSummary"));
const NotFound = lazy(() => import("./pages/NotFound"));
const MindMaps = lazy(() => import("./pages/MindMaps"));
const Flashcards = lazy(() => import("./pages/Flashcards"));
const Questions = lazy(() => import("./pages/Questions"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,      // 5 min — data is fresh
      gcTime: 10 * 60 * 1000,         // 10 min — keep in cache
      refetchOnWindowFocus: false,     // avoid refetch on tab switch
      retry: 1,                        // single retry on failure
    },
  },
});

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
      <TrialExpiredModal />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/termini" element={<Terms />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/quiz/s/:token" element={<SharedQuiz />} />
                  <Route path="/flashcards/s/:token" element={<SharedFlashcards />} />
                  <Route path="/riassunto/s/:token" element={<SharedSummary />} />
                  <Route path="/pricing" element={<PricingPage />} />
                  <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
                  <Route path="/admin" element={<ProtectedRoute><AdminRoute><Admin /></AdminRoute></ProtectedRoute>} />
                  <Route path="/study" element={<ProtectedRoute><Study /></ProtectedRoute>} />
                  <Route path="/leaderboard" element={<ProtectedRoute><Leaderboard /></ProtectedRoute>} />
                  <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
                  <Route path="/libreria" element={<ProtectedRoute><Library /></ProtectedRoute>} />
                  <Route path="/libreria/riassunto/:id" element={<ProtectedRoute><SummaryDetail /></ProtectedRoute>} />
                  <Route path="/statistiche" element={<ProtectedRoute><Statistics /></ProtectedRoute>} />
                  <Route path="/mappe-concettuali" element={<ProtectedRoute><MindMaps /></ProtectedRoute>} />
                  <Route path="/flashcards" element={<ProtectedRoute><Flashcards /></ProtectedRoute>} />
                  <Route path="/domande" element={<ProtectedRoute><Questions /></ProtectedRoute>} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
            <GenerationNotifier />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
