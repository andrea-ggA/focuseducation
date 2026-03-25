import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useSubscription } from "@/hooks/useSubscription";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Search, BookOpen, CheckCircle2, Clock, Play,
  Brain, Zap, Trophy, ChevronRight, Sparkles, Target,
  XCircle, ArrowRight, RotateCcw, Eye, AlertTriangle,
  BookMarked, RefreshCw, Star
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import AppHeader from "@/components/AppHeader";

type FilterType = "all" | "not_started" | "in_progress" | "completed";
type StatsFilter = "all" | "ready" | "to_study" | "to_review" | "new" | "reread";

interface DocumentGroup {
  document_id: string;
  document_title: string;
  quizzes: QuizInfo[];
}

interface QuizInfo {
  id: string;
  title: string;
  topic: string | null;
  total_questions: number;
  quiz_type: string;
}

interface TopicGroup {
  topic: string;
  questions: QuestionData[];
  answered: number;
  correct: number;
  total: number;
}

interface QuestionData {
  id: string;
  question: string;
  options: string[];
  correct_answer: number;
  explanation: string;
  topic: string;
  points: number;
  time_limit_seconds: number;
  quiz_id: string;
  source_reference?: string | null;
}

interface AnswerRecord {
  question_id: string;
  is_correct: boolean;
}

type View = "documents" | "chapters" | "quiz";

const Questions = () => {
  const { user } = useAuth();
  const { isPro, isHyperfocus: isADHD } = useSubscription();

  const [view, setView] = useState<View>("documents");
  const [documents, setDocuments] = useState<DocumentGroup[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentGroup | null>(null);
  const [topicGroups, setTopicGroups] = useState<TopicGroup[]>([]);
  const [userAnswers, setUserAnswers] = useState<AnswerRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [statsFilter, setStatsFilter] = useState<StatsFilter>("all");
  const [focusMode, setFocusMode] = useState(false);

  // Quiz state
  const [quizQuestions, setQuizQuestions] = useState<QuestionData[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const [quizTitle, setQuizTitle] = useState("");
  const [startTime, setStartTime] = useState(0);
  const [selectedTopicIndices, setSelectedTopicIndices] = useState<Set<number>>(new Set());

  // Fetch all documents with their quizzes
  useEffect(() => {
    if (!user) return;
    const fetchDocuments = async () => {
      setLoading(true);
      const { data: quizzes } = await supabase
        .from("quizzes")
        .select("id, title, topic, total_questions, quiz_type, document_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      const { data: docs } = await supabase
        .from("documents")
        .select("id, title")
        .eq("user_id", user.id);

      const { data: progress } = await supabase
        .from("user_question_progress")
        .select("question_id, is_correct")
        .eq("user_id", user.id);

      setUserAnswers(progress || []);

      const docMap = new Map<string, DocumentGroup>();
      const docTitleMap = new Map<string, string>();
      (docs || []).forEach(d => docTitleMap.set(d.id, d.title));

      (quizzes || []).forEach(q => {
        const docId = q.document_id || "no-doc";
        const docTitle = q.document_id ? (docTitleMap.get(q.document_id) || "Documento") : "Testo incollato";
        if (!docMap.has(docId)) {
          docMap.set(docId, { document_id: docId, document_title: docTitle, quizzes: [] });
        }
        docMap.get(docId)!.quizzes.push({
          id: q.id, title: q.title, topic: q.topic,
          total_questions: q.total_questions, quiz_type: q.quiz_type,
        });
      });

      setDocuments(Array.from(docMap.values()));
      setLoading(false);
    };
    fetchDocuments();
  }, [user]);

  const openDocument = async (doc: DocumentGroup) => {
    setSelectedDoc(doc);
    setLoading(true);

    const quizIds = doc.quizzes.map(q => q.id);
    
    // Fetch ALL questions (handle >1000 with pagination)
    let allQuestions: any[] = [];
    for (const qid of quizIds) {
      let from = 0;
      const PAGE = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("quiz_questions")
          .select("id, question, options, correct_answer, explanation, topic, points, time_limit_seconds, quiz_id, source_reference")
          .eq("quiz_id", qid)
          .order("sort_order")
          .range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        allQuestions.push(...data);
        if (data.length < PAGE) break;
        from += PAGE;
      }
    }

    const topicMap = new Map<string, QuestionData[]>();
    allQuestions.forEach(q => {
      const topic = q.topic || "Generale";
      if (!topicMap.has(topic)) topicMap.set(topic, []);
      topicMap.get(topic)!.push({ ...q, options: q.options as string[], topic });
    });

    const answeredSet = new Set(userAnswers.map(a => a.question_id));
    const correctSet = new Set(userAnswers.filter(a => a.is_correct).map(a => a.question_id));

    const groups: TopicGroup[] = Array.from(topicMap.entries()).map(([topic, qs]) => ({
      topic, questions: qs, total: qs.length,
      answered: qs.filter(q => answeredSet.has(q.id)).length,
      correct: qs.filter(q => correctSet.has(q.id)).length,
    }));

    groups.sort((a, b) => {
      const aP = a.answered / a.total;
      const bP = b.answered / b.total;
      if (aP < 1 && bP >= 1) return -1;
      if (bP < 1 && aP >= 1) return 1;
      return a.topic.localeCompare(b.topic);
    });

    setTopicGroups(groups);
    setView("chapters");
    setLoading(false);
  };

  // Statistics calculations
  const stats = useMemo(() => {
    const allQs = topicGroups.flatMap(g => g.questions);
    const answeredMap = new Map(userAnswers.map(a => [a.question_id, a.is_correct]));

    const ready = allQs.filter(q => answeredMap.get(q.id) === true).length; // Answered correctly
    const wrong = allQs.filter(q => answeredMap.get(q.id) === false); // Answered wrong = "rileggi"
    const answered = allQs.filter(q => answeredMap.has(q.id));
    const notAnswered = allQs.filter(q => !answeredMap.has(q.id));
    
    // "Da ripassare" = answered correctly but older (simulate with answered once correctly)
    // "Nuove" = never answered
    // "Da studiare" = all not yet mastered
    return {
      total: allQs.length,
      ready, // ✅ Pronte (answered correctly)
      toStudy: notAnswered.length, // 📖 Da studiare (never attempted)
      toReview: Math.max(0, ready - Math.floor(ready * 0.7)), // 🔄 Da ripassare (30% of correct for SRS)
      newQ: notAnswered.length, // 🆕 Nuove
      reread: wrong.length, // 📕 Rileggi (wrong answers)
    };
  }, [topicGroups, userAnswers]);

  const totalQuestions = useMemo(() => topicGroups.reduce((s, g) => s + g.total, 0), [topicGroups]);
  const totalAnswered = useMemo(() => topicGroups.reduce((s, g) => s + g.answered, 0), [topicGroups]);
  const totalCorrect = useMemo(() => topicGroups.reduce((s, g) => s + g.correct, 0), [topicGroups]);

  // Filter topics by stats filter
  const filteredTopics = useMemo(() => {
    let result = topicGroups;
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(g => g.topic.toLowerCase().includes(s));
    }
    if (filter === "not_started") result = result.filter(g => g.answered === 0);
    else if (filter === "in_progress") result = result.filter(g => g.answered > 0 && g.answered < g.total);
    else if (filter === "completed") result = result.filter(g => g.answered >= g.total);
    return result;
  }, [topicGroups, search, filter]);

  const startTopicQuiz = (topics: TopicGroup[], onlyWrong = false) => {
    let allQuestions = topics.flatMap(t => t.questions);
    
    if (onlyWrong) {
      const wrongSet = new Set(userAnswers.filter(a => !a.is_correct).map(a => a.question_id));
      allQuestions = allQuestions.filter(q => wrongSet.has(q.id));
    }
    
    const shuffled = [...allQuestions].sort(() => Math.random() - 0.5);
    setQuizQuestions(shuffled);
    setQuizTitle(topics.length === 1 ? topics[0].topic : `${topics.length} argomenti selezionati`);
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setShowResult(false);
    setScore(0);
    setCorrectCount(0);
    setFinished(false);
    setStartTime(Date.now());
    setView("quiz");
  };

  const handleAnswer = useCallback(async (index: number) => {
    if (showResult || quizQuestions.length === 0) return;
    setSelectedAnswer(index);
    setShowResult(true);

    const q = quizQuestions[currentIndex];
    const isCorrect = index === q.correct_answer;

    if (isCorrect) {
      setScore(p => p + q.points);
      setCorrectCount(p => p + 1);
    }

    if (user) {
      await supabase.from("user_question_progress").insert({
        user_id: user.id, question_id: q.id, quiz_id: q.quiz_id,
        is_correct: isCorrect, selected_answer: index,
      });
      if (isCorrect) {
        await supabase.from("xp_log").insert({
          user_id: user.id, xp_amount: q.points, source: "question", source_id: q.id,
        });
      }
      setUserAnswers(prev => [...prev, { question_id: q.id, is_correct: isCorrect }]);
    }
  }, [showResult, quizQuestions, currentIndex, user]);

  const nextQuestion = async () => {
    if (currentIndex + 1 >= quizQuestions.length) {
      setFinished(true);
      // FIX: salva quiz_attempt quando il quiz termina
      // Prima mancava questo → Statistics non mostrava i quiz completati in questa pagina
      if (user && quizQuestions.length > 0) {
        const quizId = quizQuestions[0]?.quiz_id;
        const timeTaken = startTime > 0 ? Math.round((Date.now() - startTime) / 1000) : 0;
        await supabase.from("quiz_attempts").insert({
          user_id: user.id,
          quiz_id: quizId,
          score,
          total_points: quizQuestions.reduce((s, q) => s + (q.points || 10), 0),
          correct_answers: correctCount,
          total_answered: quizQuestions.length,
          time_taken_seconds: timeTaken,
          xp_earned: score,
        }).then(({ error }) => {
          if (error) console.warn("[Questions] quiz_attempts insert failed:", error.message);
        });
      }
      return;
    }
    setCurrentIndex(p => p + 1);
    setSelectedAnswer(null);
    setShowResult(false);
  };

  const backToChapters = () => {
    setView("chapters");
    const answeredSet = new Set(userAnswers.map(a => a.question_id));
    const correctSet = new Set(userAnswers.filter(a => a.is_correct).map(a => a.question_id));
    setTopicGroups(prev => prev.map(g => ({
      ...g,
      answered: g.questions.filter(q => answeredSet.has(q.id)).length,
      correct: g.questions.filter(q => correctSet.has(q.id)).length,
    })));
  };

  const toggleTopic = (idx: number) => {
    setSelectedTopicIndices(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const getStatus = (g: TopicGroup) => {
    if (g.answered === 0) return "not_started" as const;
    if (g.answered >= g.total) return "completed" as const;
    return "in_progress" as const;
  };

  const getNextRecommended = (): number => {
    const idx = filteredTopics.findIndex(g => g.answered < g.total);
    return idx >= 0 ? idx : 0;
  };

  if (loading && view === "documents") {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="container mx-auto px-4 py-8 max-w-4xl">
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Back button */}
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild={view === "documents"} onClick={view !== "documents" ? () => {
            if (view === "quiz") backToChapters();
            else { setView("documents"); setSelectedDoc(null); setSelectedTopicIndices(new Set()); }
          } : undefined}>
            {view === "documents" ? (
              <Link to="/dashboard"><ArrowLeft className="h-4 w-4 mr-2" /> Dashboard</Link>
            ) : (
              <span className="flex items-center"><ArrowLeft className="h-4 w-4 mr-2" /> {view === "quiz" ? "Argomenti" : "Documenti"}</span>
            )}
          </Button>
        </div>

        {/* DOCUMENTS VIEW */}
        {view === "documents" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground flex items-center gap-3">
                <Target className="h-7 w-7 text-primary" /> Domande
              </h1>
              <p className="text-muted-foreground mt-1">
                Seleziona un documento per visualizzare e rispondere alle domande per argomento.
              </p>
            </div>

            {documents.length === 0 ? (
              <div className="bg-card rounded-xl border border-border shadow-card p-12 text-center">
                <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-card-foreground mb-2">Nessun quiz disponibile</h3>
                <p className="text-muted-foreground mb-4">Carica un documento nello Studio AI per generare le domande.</p>
                <Button asChild><Link to="/study"><Sparkles className="h-4 w-4 mr-2" /> Vai allo Studio AI</Link></Button>
              </div>
            ) : (
              <div className="space-y-3">
                {documents.map((doc, i) => {
                  const totalQ = doc.quizzes.reduce((s, q) => s + q.total_questions, 0);
                  return (
                    <motion.div key={doc.document_id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                      <button
                        onClick={() => openDocument(doc)}
                        className="w-full text-left bg-card rounded-xl border border-border shadow-card p-5 hover:border-primary/40 hover:shadow-soft transition-all group"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-card-foreground truncate group-hover:text-primary transition-colors">
                              {doc.document_title}
                            </h3>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {doc.quizzes.length} quiz · {totalQ} domande totali
                            </p>
                          </div>
                          <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                        </div>
                      </button>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {/* CHAPTERS VIEW */}
        {view === "chapters" && selectedDoc && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-foreground">{selectedDoc.document_title}</h1>
              <div className="flex items-center gap-4 mt-2 flex-wrap">
                <Badge variant="secondary" className="text-xs">{totalQuestions} domande</Badge>
                <Badge variant="secondary" className="text-xs">{totalAnswered} risposte</Badge>
                <Badge variant="default" className="text-xs">
                  {totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0}% corretto
                </Badge>
              </div>
              <Progress value={totalQuestions > 0 ? (totalAnswered / totalQuestions) * 100 : 0} className="mt-3 h-2" />
            </div>

            {/* STATISTICS DASHBOARD */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <StatCard
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Pronte"
                count={stats.ready}
                color="text-primary"
                bgColor="bg-primary/10"
                active={statsFilter === "ready"}
                onClick={() => setStatsFilter(statsFilter === "ready" ? "all" : "ready")}
              />
              <StatCard
                icon={<BookOpen className="h-4 w-4" />}
                label="Da studiare"
                count={stats.toStudy}
                color="text-blue-600"
                bgColor="bg-blue-500/10"
                active={statsFilter === "to_study"}
                onClick={() => setStatsFilter(statsFilter === "to_study" ? "all" : "to_study")}
              />
              <StatCard
                icon={<RefreshCw className="h-4 w-4" />}
                label="Da ripassare"
                count={stats.toReview}
                color="text-amber-600"
                bgColor="bg-amber-500/10"
                active={statsFilter === "to_review"}
                onClick={() => setStatsFilter(statsFilter === "to_review" ? "all" : "to_review")}
              />
              <StatCard
                icon={<Star className="h-4 w-4" />}
                label="Nuove"
                count={stats.newQ}
                color="text-purple-600"
                bgColor="bg-purple-500/10"
                active={statsFilter === "new"}
                onClick={() => setStatsFilter(statsFilter === "new" ? "all" : "new")}
              />
              <StatCard
                icon={<Eye className="h-4 w-4" />}
                label="Rileggi"
                count={stats.reread}
                color="text-destructive"
                bgColor="bg-destructive/10"
                active={statsFilter === "reread"}
                onClick={() => setStatsFilter(statsFilter === "reread" ? "all" : "reread")}
              />
            </div>

            {/* Quick action for "Rileggi" */}
            {stats.reread > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="bg-destructive/5 rounded-xl p-4 border border-destructive/20 flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-medium text-card-foreground">
                    Hai {stats.reread} domande sbagliate da rivedere
                  </span>
                </div>
                <Button size="sm" variant="outline" className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  onClick={() => startTopicQuiz(topicGroups, true)}
                >
                  <Eye className="h-3.5 w-3.5 mr-1.5" /> Rivedi errori
                </Button>
              </motion.div>
            )}

            {/* Search & Filter */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Cerca argomento..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {(["all", "not_started", "in_progress", "completed"] as FilterType[]).map(f => (
                  <Button key={f} variant={filter === f ? "default" : "outline"} size="sm" onClick={() => setFilter(f)} className="text-xs">
                    {f === "all" ? "Tutti" : f === "not_started" ? "Non iniziati" : f === "in_progress" ? "In corso" : "Completati"}
                  </Button>
                ))}
              </div>
            </div>

            {/* ADHD Focus Mode */}
            {isADHD && (
              <div className="flex items-center gap-3 bg-accent/10 rounded-xl p-3 border border-accent/20">
                <Brain className="h-5 w-5 text-accent" />
                <span className="text-sm font-medium text-card-foreground flex-1">Modalità Focus ADHD</span>
                <Button variant={focusMode ? "default" : "outline"} size="sm" onClick={() => setFocusMode(!focusMode)} className="text-xs">
                  {focusMode ? "Attiva ✓" : "Attiva"}
                </Button>
              </div>
            )}

            {/* Multi-select action bar */}
            {selectedTopicIndices.size > 0 && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="bg-primary/10 rounded-xl p-4 flex items-center justify-between border border-primary/20"
              >
                <p className="text-sm font-medium text-card-foreground">
                  {selectedTopicIndices.size} argomenti · {Array.from(selectedTopicIndices).reduce((s, i) => s + (filteredTopics[i]?.total || 0), 0)} domande
                </p>
                <Button size="sm" onClick={() => {
                  const topics = Array.from(selectedTopicIndices).map(i => filteredTopics[i]).filter(Boolean);
                  startTopicQuiz(topics);
                }}>
                  <Play className="h-4 w-4 mr-1.5" /> Quiz generale
                </Button>
              </motion.div>
            )}

            {/* Focus mode micro-task */}
            {focusMode && filteredTopics.length > 0 && (
              <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
                className="bg-accent/10 rounded-xl p-4 border border-accent/20"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="h-4 w-4 text-accent" />
                  <span className="text-sm font-bold text-card-foreground">Prossimo step consigliato</span>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Fai 5 domande su "{filteredTopics[getNextRecommended()]?.topic}" — ci vogliono solo 2 minuti!
                </p>
                <Button size="sm" variant="outline"
                  className="border-accent text-accent hover:bg-accent hover:text-accent-foreground"
                  onClick={() => {
                    const topic = filteredTopics[getNextRecommended()];
                    if (topic) {
                      const subset = { ...topic, questions: topic.questions.slice(0, 5) };
                      startTopicQuiz([subset]);
                    }
                  }}
                >
                  <Play className="h-3.5 w-3.5 mr-1.5" /> Inizia micro-sessione
                </Button>
              </motion.div>
            )}

            {/* Topic cards */}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
              </div>
            ) : filteredTopics.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">Nessun argomento trovato.</div>
            ) : (
              <div className="space-y-3">
                {(focusMode ? [filteredTopics[getNextRecommended()]] : filteredTopics).filter(Boolean).map((group, i) => {
                  const realIdx = filteredTopics.indexOf(group);
                  const status = getStatus(group);
                  const percentage = group.total > 0 ? Math.round((group.answered / group.total) * 100) : 0;
                  const isSelected = selectedTopicIndices.has(realIdx);
                  const wrongCount = group.questions.filter(q => 
                    userAnswers.some(a => a.question_id === q.id && !a.is_correct)
                  ).length;

                  return (
                    <motion.div key={group.topic} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                      className={`bg-card rounded-xl border shadow-card p-5 transition-all ${
                        isSelected ? "border-primary ring-2 ring-primary/20" : "border-border hover:border-primary/30"
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <button onClick={() => toggleTopic(realIdx)}
                          className={`mt-1 h-5 w-5 rounded border-2 shrink-0 flex items-center justify-center transition-all ${
                            isSelected ? "bg-primary border-primary" : "border-muted-foreground/40 hover:border-primary"
                          }`}
                        >
                          {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-primary-foreground" />}
                        </button>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <h3 className="font-semibold text-card-foreground truncate">{group.topic}</h3>
                            <Badge variant="secondary"
                              className={`text-[10px] shrink-0 ${
                                status === "completed" ? "bg-primary/10 text-primary" :
                                status === "in_progress" ? "bg-blue-500/10 text-blue-600" : ""
                              }`}
                            >
                              {status === "completed" ? "Completato" : status === "in_progress" ? "In corso" : "Non iniziato"}
                            </Badge>
                          </div>

                          <p className="text-xs text-muted-foreground mb-1">
                            {group.total} domande · {group.correct}/{group.answered} corrette
                            {wrongCount > 0 && <span className="text-destructive ml-1">· {wrongCount} da rivedere</span>}
                          </p>

                          <div className="flex items-center gap-3">
                            <div className="flex-1">
                              <Progress value={percentage}
                                className={`h-2 ${status === "completed" ? "[&>div]:bg-primary" : status === "in_progress" ? "[&>div]:bg-blue-500" : ""}`}
                              />
                            </div>
                            <span className="text-xs font-medium text-muted-foreground w-10 text-right">{percentage}%</span>
                          </div>
                        </div>

                        <div className="flex flex-col gap-1.5 shrink-0">
                          <Button size="sm" variant={status === "completed" ? "outline" : "default"}
                            onClick={() => startTopicQuiz([group])} className="text-xs"
                          >
                            <Play className="h-3.5 w-3.5 mr-1" />
                            {status === "not_started" ? "Inizia" : status === "in_progress" ? "Continua" : "Ripeti"}
                          </Button>
                          {wrongCount > 0 && (
                            <Button size="sm" variant="outline" onClick={() => startTopicQuiz([group], true)}
                              className="text-xs border-destructive/30 text-destructive hover:bg-destructive/10"
                            >
                              <Eye className="h-3 w-3 mr-1" /> Rileggi ({wrongCount})
                            </Button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}

            {/* Motivational */}
            {isADHD && totalAnswered > 0 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-4">
                <p className="text-sm font-medium text-primary">
                  {totalAnswered < 10 ? "🔥 Ottimo inizio! Continua così!" :
                   totalAnswered < 30 ? "⚡ Stai andando forte!" :
                   totalAnswered < 50 ? "🚀 Sei inarrestabile!" :
                   "🏆 Incredibile! Stai dominando!"}
                </p>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* QUIZ VIEW */}
        {view === "quiz" && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="bg-card rounded-xl border border-border shadow-card p-6">
              {finished ? (
                <QuizFinished title={quizTitle} correctCount={correctCount} total={quizQuestions.length}
                  score={score} startTime={startTime} onBack={backToChapters} />
              ) : quizQuestions.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-muted-foreground">Nessuna domanda disponibile.</p>
                  <Button variant="outline" onClick={backToChapters} className="mt-4">Torna indietro</Button>
                </div>
              ) : (
                <QuizQuestion question={quizQuestions[currentIndex]} index={currentIndex}
                  total={quizQuestions.length} selectedAnswer={selectedAnswer} showResult={showResult}
                  score={score} onAnswer={handleAnswer} onNext={nextQuestion} />
              )}
            </div>
          </motion.div>
        )}
      </main>
    </div>
  );
};

// Statistics card
const StatCard = ({ icon, label, count, color, bgColor, active, onClick }: {
  icon: React.ReactNode; label: string; count: number; color: string; bgColor: string;
  active: boolean; onClick: () => void;
}) => (
  <button onClick={onClick}
    className={`rounded-xl p-3 text-center transition-all border ${
      active ? `${bgColor} border-current ${color} ring-2 ring-current/20` : `bg-card border-border hover:${bgColor}`
    }`}
  >
    <div className={`flex justify-center mb-1 ${color}`}>{icon}</div>
    <p className={`text-lg font-bold ${color}`}>{count}</p>
    <p className="text-[10px] text-muted-foreground">{label}</p>
  </button>
);

// Quiz question with source reference
const QuizQuestion = ({
  question, index, total, selectedAnswer, showResult, score, onAnswer, onNext
}: {
  question: QuestionData; index: number; total: number; selectedAnswer: number | null;
  showResult: boolean; score: number; onAnswer: (i: number) => void; onNext: () => void;
}) => {
  const progress = ((index + 1) / total) * 100;
  const isWrong = showResult && selectedAnswer !== null && selectedAnswer !== question.correct_answer;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{question.topic}</p>
          <p className="text-sm font-medium text-card-foreground">Domanda {index + 1} di {total}</p>
        </div>
        <span className="text-sm font-bold text-primary">{score} pts</span>
      </div>

      <Progress value={progress} className="h-1.5" />

      <AnimatePresence mode="wait">
        <motion.div key={index} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
          <h3 className="text-lg font-semibold text-card-foreground mb-6">{question.question}</h3>

          <div className="space-y-3">
            {(question.options as string[]).map((opt, i) => {
              let style = "border-border hover:border-primary/50 hover:bg-secondary/50";
              if (showResult) {
                if (i === question.correct_answer) style = "border-primary bg-primary/10";
                else if (i === selectedAnswer && i !== question.correct_answer) style = "border-destructive bg-destructive/10";
                else style = "border-border opacity-50";
              }
              return (
                <button key={i} onClick={() => !showResult && onAnswer(i)} disabled={showResult}
                  className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-center gap-3 ${style}`}
                >
                  <span className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center text-xs font-bold text-secondary-foreground shrink-0">
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="text-sm text-card-foreground flex-1">{opt}</span>
                  {showResult && i === question.correct_answer && <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />}
                  {showResult && i === selectedAnswer && i !== question.correct_answer && <XCircle className="h-5 w-5 text-destructive shrink-0" />}
                </button>
              );
            })}
          </div>

          {/* Explanation */}
          {showResult && question.explanation && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 p-4 bg-secondary rounded-xl">
              <p className="text-sm text-secondary-foreground">
                <strong>Spiegazione:</strong> {question.explanation}
              </p>
            </motion.div>
          )}

          {/* Source reference on wrong answer */}
          {isWrong && question.source_reference && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className="mt-3 p-4 bg-destructive/5 rounded-xl border border-destructive/20"
            >
              <div className="flex items-start gap-2">
                <BookMarked className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-destructive mb-1">📖 Dalla fonte:</p>
                  <p className="text-sm text-card-foreground italic">"{question.source_reference}"</p>
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>

      {showResult && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Button onClick={onNext} className="w-full">
            {index + 1 >= total ? (
              <><Trophy className="h-4 w-4 mr-2" /> Vedi risultati</>
            ) : (
              <><ArrowRight className="h-4 w-4 mr-2" /> Prossima domanda</>
            )}
          </Button>
        </motion.div>
      )}
    </div>
  );
};

const QuizFinished = ({
  title, correctCount, total, score, startTime, onBack
}: {
  title: string; correctCount: number; total: number; score: number; startTime: number; onBack: () => void;
}) => {
  const percentage = Math.round((correctCount / total) * 100);
  const timeTaken = Math.round((Date.now() - startTime) / 1000);
  const minutes = Math.floor(timeTaken / 60);
  const seconds = timeTaken % 60;

  return (
    <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-8">
      <h2 className="text-2xl font-bold text-card-foreground mb-2">Sessione completata!</h2>
      <p className="text-muted-foreground mb-6">{title}</p>
      <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto mb-8">
        <div className="bg-secondary rounded-xl p-4">
          <p className="text-2xl font-bold text-card-foreground">{correctCount}/{total}</p>
          <p className="text-xs text-muted-foreground">Corrette</p>
        </div>
        <div className="bg-secondary rounded-xl p-4">
          <p className="text-2xl font-bold text-primary">{score}</p>
          <p className="text-xs text-muted-foreground">Punti</p>
        </div>
        <div className="bg-secondary rounded-xl p-4">
          <p className="text-2xl font-bold text-card-foreground">{percentage}%</p>
          <p className="text-xs text-muted-foreground">Precisione</p>
        </div>
        <div className="bg-secondary rounded-xl p-4">
          <p className="text-2xl font-bold text-card-foreground">
            {minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`}
          </p>
          <p className="text-xs text-muted-foreground">Tempo</p>
        </div>
      </div>
      {percentage >= 80 && (
        <p className="text-sm font-medium text-primary mb-4">🎉 Eccellente! Stai padroneggiando questo argomento!</p>
      )}
      <Button variant="outline" onClick={onBack}>
        <RotateCcw className="h-4 w-4 mr-2" /> Torna agli argomenti
      </Button>
    </motion.div>
  );
};

export default Questions;
