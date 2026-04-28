import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { FileText, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { SAFE_MARKDOWN_COMPONENTS, isSafeShareToken } from "@/lib/security";

interface SharedSummaryContent {
  markdown?: string;
}

const SharedSummary = () => {
  const { token } = useParams<{ token: string }>();
  const [title, setTitle] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [creatorName, setCreatorName] = useState<string | null>(null);

  useEffect(() => {
    if (!isSafeShareToken(token)) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const fetch = async () => {
      const { data } = await supabase
        .from("generated_content")
        .select("title, content, user_id")
        .eq("share_token", token)
        .maybeSingle();

      if (!data) { setNotFound(true); setLoading(false); return; }
      setTitle(data.title || "Riassunto");
      const content = data.content as SharedSummaryContent | null;
      setMarkdown(content?.markdown || JSON.stringify(data.content));

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", data.user_id)
        .maybeSingle();
      if (profile?.full_name) setCreatorName(profile.full_name);
      setLoading(false);
    };
    fetch();
  }, [token]);

  if (loading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
    </div>
  );

  if (notFound) return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-foreground mb-2">Contenuto non trovato</h1>
        <p className="text-muted-foreground mb-6">Questo link non è valido o il contenuto non è più condiviso.</p>
        <Button asChild><Link to="/">Vai alla home</Link></Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          {creatorName && <p className="text-sm text-muted-foreground">Condiviso da {creatorName}</p>}
        </div>

        {/* Content */}
        <div className="bg-card rounded-xl border border-border shadow-lg p-6 md:p-8 prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown components={SAFE_MARKDOWN_COMPONENTS}>{markdown}</ReactMarkdown>
        </div>

        {/* CTA */}
        <div className="bg-card border border-border rounded-xl p-5 text-center space-y-3">
          <h3 className="font-semibold text-card-foreground">Genera riassunti con l'AI! 🚀</h3>
          <p className="text-sm text-muted-foreground">
            Carica qualsiasi documento e FocusEd genera riassunti, quiz e flashcard automaticamente.
          </p>
          <Button asChild className="w-full">
            <Link to="/auth"><Sparkles className="h-4 w-4 mr-2" /> Registrati gratis</Link>
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Generato con <Link to="/" className="text-primary font-medium hover:underline">FocusEd</Link>
        </p>
      </motion.div>
    </div>
  );
};

export default SharedSummary;
