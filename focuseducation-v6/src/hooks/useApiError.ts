import { useToast } from "@/hooks/use-toast";
import { useCallback } from "react";

export type ApiErrorContext =
  | "generation" | "credits" | "auth"
  | "save" | "load" | "generic";

const ERROR_MESSAGES: Record<ApiErrorContext, string> = {
  generation: "Errore durante la generazione. Riprova.",
  credits:    "Crediti insufficienti per questa operazione.",
  auth:       "Sessione scaduta. Effettua il login.",
  save:       "Impossibile salvare. Controlla la connessione.",
  load:       "Impossibile caricare i dati.",
  generic:    "Si è verificato un errore imprevisto.",
};

export function useApiError() {
  const { toast } = useToast();

  const handleError = useCallback(
    (err: unknown, context: ApiErrorContext = "generic", customMessage?: string) => {
      let message = customMessage ?? ERROR_MESSAGES[context];

      if (err instanceof Error) {
        if (err.message.includes("insufficient_credits"))  message = ERROR_MESSAGES.credits;
        else if (err.message.includes("Sessione scaduta")) message = ERROR_MESSAGES.auth;
        else if (err.message.includes("troppo tempo"))     message = "Il server ha impiegato troppo tempo. Riprova con un file più corto.";
        else if (import.meta.env.DEV)                      message = err.message;
      }

      toast({ title: "Errore", description: message, variant: "destructive" });
      console.error(`[${context}]:`, err);
    },
    [toast]
  );

  return { handleError };
}
