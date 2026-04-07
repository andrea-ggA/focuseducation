import { useState, forwardRef } from "react";
import { Share2, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

type ShareableType = "quiz" | "flashcard_deck" | "summary";

interface ShareButtonProps {
  type: ShareableType;
  id: string;
  shareToken: string | null;
  onTokenGenerated?: (token: string) => void;
  size?: "sm" | "icon";
}

const TABLE_MAP: Record<ShareableType, string> = {
  quiz: "quizzes",
  flashcard_deck: "flashcard_decks",
  summary: "generated_content",
};

const ROUTE_MAP: Record<ShareableType, string> = {
  quiz: "/quiz/s/",
  flashcard_deck: "/flashcards/s/",
  summary: "/riassunto/s/",
};

const ShareButton = forwardRef<HTMLButtonElement, ShareButtonProps>(
  ({ type, id, shareToken, onTokenGenerated, size = "icon" }, ref) => {
    const { toast } = useToast();
    const [copied, setCopied] = useState(false);
    const [loading, setLoading] = useState(false);

    const generateAndCopy = async () => {
      setLoading(true);
      try {
        let token = shareToken;

        if (!token) {
          token = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
          const { error } = await supabase
            .from(TABLE_MAP[type] as any)
            .update({ share_token: token } as any)
            .eq("id", id);

          if (error) {
            toast({ title: "Errore nella condivisione", variant: "destructive" });
            return;
          }

          onTokenGenerated?.(token);
        }

        const url = `${window.location.origin}${ROUTE_MAP[type]}${token}`;

        if (navigator.share) {
          try {
            await navigator.share({ url, title: "Condiviso da FocusEd" });
            return;
          } catch {
          }
        }

        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast({ title: "Link copiato! 🔗", description: "Chiunque può accedere con questo link." });
      } finally {
        setLoading(false);
      }
    };

    if (size === "sm") {
      return (
        <Button
          ref={ref}
          size="sm"
          variant="ghost"
          onClick={(e) => {
            e.stopPropagation();
            generateAndCopy();
          }}
          disabled={loading}
          className="text-muted-foreground hover:text-primary"
        >
          {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Share2 className="h-3.5 w-3.5 mr-1" />}
          {copied ? "Copiato!" : "Condividi"}
        </Button>
      );
    }

    return (
      <Button
        ref={ref}
        size="icon"
        variant="ghost"
        onClick={(e) => {
          e.stopPropagation();
          generateAndCopy();
        }}
        disabled={loading}
        className="h-8 w-8 text-muted-foreground hover:text-primary"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
      </Button>
    );
  },
);

ShareButton.displayName = "ShareButton";

export default ShareButton;
