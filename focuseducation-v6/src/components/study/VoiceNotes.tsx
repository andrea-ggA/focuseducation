import { useState, useRef } from "react";
import { Upload, Loader2, FileText, Send, Trash2, FileAudio, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAuthToken, transcribeAudio } from "@/lib/backendApi";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCredits, CREDIT_COSTS } from "@/hooks/useCredits";
import { motion } from "framer-motion";

interface VoiceNotesProps {
  onNotesGenerated: (text: string) => void;
}

const ACCEPTED_AUDIO_FORMATS = ".mp3,.wav,.ogg,.m4a,.aac,.flac,.wma,.webm,.opus,.mp4";

const VoiceNotes = ({ onNotesGenerated }: VoiceNotesProps) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { totalCredits, spendCredits } = useCredits();
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const cost = CREDIT_COSTS.voice_notes;
  const canAfford = totalCredits >= cost;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      toast({ title: "File troppo grande", description: "Il file audio deve essere inferiore a 25 MB.", variant: "destructive" });
      return;
    }

    setAudioFile(file);
    setTranscript("");
  };

  const transcribeAndGenerateNotes = async () => {
    if (!audioFile || !user) return;

    if (!canAfford) {
      toast({
        title: "Crediti insufficienti",
        description: `Servono ${cost} NeuroCredits per generare appunti da audio. Hai ${totalCredits} crediti.`,
        variant: "destructive",
      });
      return;
    }

    setTranscribing(true);

    try {
      // Spend credits first
      const spent = await spendCredits("voice_notes");
      if (!spent) {
        toast({ title: "Crediti insufficienti", variant: "destructive" });
        return;
      }

      const token = await getAuthToken();
      const notes = await transcribeAudio(audioFile, token);
      if (notes.length < 20) {
        toast({
          title: "Trascrizione incompleta",
          description: "L'audio potrebbe non essere chiaro. Prova con un file audio di qualità migliore.",
          variant: "destructive",
        });
        return;
      }

      setTranscript(notes);
      toast({ title: "Appunti generati! 📝", description: `${notes.length} caratteri di appunti strutturati.` });
    } catch (err: any) {
      console.error("Transcription error:", err);
      toast({
        title: "Errore trascrizione",
        description: err.message || "Trascrizione fallita. Riprova.",
        variant: "destructive",
      });
    } finally {
      setTranscribing(false);
    }
  };

  const handleUseNotes = () => {
    if (transcript) {
      onNotesGenerated(transcript);
      toast({ title: "Appunti pronti!", description: "Puoi ora generare quiz e flashcard dai tuoi appunti vocali." });
    }
  };

  const resetUpload = () => {
    setAudioFile(null);
    setTranscript("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <FileAudio className="h-5 w-5 text-accent" />
        <h3 className="text-sm font-semibold text-card-foreground">Appunti da audio</h3>
        <span className="text-[10px] text-muted-foreground bg-accent/10 px-2 py-0.5 rounded-full">ADHD+</span>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          <Coins className="h-3 w-3" /> {cost} crediti
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        Carica una registrazione audio di una lezione o le tue note vocali. L'AI trascriverà e strutturerà tutto in appunti organizzati.
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_AUDIO_FORMATS}
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Upload controls */}
      <div className="flex gap-3">
        <Button
          onClick={() => fileInputRef.current?.click()}
          variant="outline"
          className="flex-1 border-accent/30 text-accent hover:bg-accent hover:text-accent-foreground"
          disabled={transcribing}
        >
          <Upload className="h-4 w-4 mr-2" />
          {audioFile ? "Cambia file" : "Carica audio"}
        </Button>

        {audioFile && (
          <>
            <Button
              onClick={transcribeAndGenerateNotes}
              disabled={transcribing || !canAfford}
              className="flex-1"
            >
              {transcribing ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Elaborando...</>
              ) : (
                <><FileText className="h-4 w-4 mr-2" /> Genera appunti</>
              )}
            </Button>
            <Button
              onClick={resetUpload}
              variant="ghost"
              size="icon"
              className="shrink-0"
              disabled={transcribing}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>

      {/* Credit warning */}
      {audioFile && !canAfford && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <Coins className="h-3 w-3" /> Crediti insufficienti ({totalCredits}/{cost} necessari)
        </p>
      )}

      {/* File info */}
      {audioFile && !transcript && !transcribing && (
        <div className="flex items-center gap-2 p-3 bg-secondary rounded-xl text-sm text-muted-foreground">
          <FileAudio className="h-4 w-4" />
          <span className="truncate">{audioFile.name}</span>
          <span className="shrink-0">({formatFileSize(audioFile.size)})</span>
        </div>
      )}

      {/* Supported formats hint */}
      {!audioFile && (
        <p className="text-[10px] text-muted-foreground">
          Formati supportati: MP3, WAV, OGG, M4A, AAC, FLAC, WMA, WebM, OPUS, MP4
        </p>
      )}

      {/* Transcript result */}
      {transcript && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div className="bg-secondary rounded-xl p-4 max-h-64 overflow-y-auto">
            <p className="text-sm text-secondary-foreground whitespace-pre-wrap leading-relaxed">{transcript}</p>
          </div>
          <Button onClick={handleUseNotes} className="w-full">
            <Send className="h-4 w-4 mr-2" /> Usa questi appunti per generare quiz e flashcard
          </Button>
        </motion.div>
      )}
    </div>
  );
};

export default VoiceNotes;