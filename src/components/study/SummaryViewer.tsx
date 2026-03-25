import { useState } from "react";
import { ArrowLeft, Download, FileText, ScrollText, BookMarked, Printer, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import { motion } from "framer-motion";
import { useSubscription } from "@/hooks/useSubscription";
import { useToast } from "@/hooks/use-toast";

interface SummaryViewerProps {
  content: string;
  format: "summary" | "outline" | "smart_notes";
  title: string;
  onBack: () => void;
}

const FORMAT_LABELS = {
  summary:     { label: "Riassunto",    icon: FileText,   emoji: "📄" },
  outline:     { label: "Schema",       icon: ScrollText, emoji: "🗂️" },
  smart_notes: { label: "Appunti Smart",icon: BookMarked, emoji: "📝" },
};

function markdownToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3 style="margin:16px 0 6px;font-size:14px;font-weight:700;color:#111;">$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2 style="margin:22px 0 8px;font-size:16px;font-weight:700;border-bottom:1px solid #e5e7eb;padding-bottom:4px;">$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1 style="margin:0 0 16px;font-size:20px;font-weight:800;">$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,   '<em>$1</em>')
    .replace(/^- (.+)$/gm,   '<li style="margin-bottom:4px;">$1</li>')
    .replace(/(<li.*<\/li>\n?)+/g, (m) => `<ul style="margin:8px 0 12px;padding-left:20px;">${m}</ul>`)
    .replace(/\n\n/g, '</p><p style="margin-bottom:10px;">')
    .replace(/^(?!<[h|u|p|l])(.+)$/gm, '<p style="margin-bottom:10px;">$1</p>');
}

const SummaryViewer = ({ content, format, title, onBack }: SummaryViewerProps) => {
  const { canExportPdf } = useSubscription();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const info = FORMAT_LABELS[format];

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadMd = () => {
    const blob = new Blob([content], { type: "text/markdown" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${title.replace(/[^a-zA-Z0-9]/g, "_")}_${format}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    if (!canExportPdf) {
      toast({ title: "Piano Focus Pro richiesto", description: "L'export PDF è disponibile con Focus Pro o Hyperfocus Master.", variant: "destructive" });
      return;
    }

    const htmlContent = markdownToHtml(content);
    const printWindow = window.open("", "_blank");
    if (!printWindow) { toast({ title: "Popup bloccato", description: "Consenti i popup per esportare in PDF.", variant: "destructive" }); return; }

    printWindow.document.write(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Georgia, serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.7; font-size: 14px; }
    h1 { font-family: system-ui; font-size: 22px; color: #2a9d8f; border-bottom: 2px solid #2a9d8f; padding-bottom: 8px; margin-bottom: 20px; }
    h2 { font-family: system-ui; font-size: 17px; color: #264653; margin-top: 28px; }
    h3 { font-family: system-ui; font-size: 15px; color: #264653; margin-top: 18px; }
    p { margin-bottom: 10px; }
    ul { padding-left: 20px; margin-bottom: 12px; }
    li { margin-bottom: 4px; }
    strong { color: #2a9d8f; }
    .meta { font-size: 11px; color: #6b7280; margin-bottom: 28px; font-family: system-ui; }
    @media print { @page { margin: 2cm; } body { margin: 0; } }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p class="meta">Generato con FocusED · ${new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" })}</p>
  ${htmlContent}
</body>
</html>`);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => { printWindow.print(); printWindow.close(); }, 600);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold text-card-foreground flex items-center gap-2">
              <span>{info.emoji}</span> {title}
            </h2>
            <p className="text-xs text-muted-foreground">{info.label}</p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? <><Check className="h-3.5 w-3.5 mr-1 text-primary" />Copiato!</> : <><Copy className="h-3.5 w-3.5 mr-1" />Copia</>}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownloadMd}>
            <Download className="h-3.5 w-3.5 mr-1" /> .md
          </Button>
          <Button
            variant={canExportPdf ? "outline" : "ghost"}
            size="sm"
            onClick={handleExportPdf}
            className={!canExportPdf ? "opacity-50" : ""}
            title={!canExportPdf ? "Richiede Focus Pro" : "Esporta in PDF"}
          >
            <Printer className="h-3.5 w-3.5 mr-1" /> PDF
            {!canExportPdf && <span className="ml-1 text-[9px] bg-primary/20 text-primary rounded px-1">Pro</span>}
          </Button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-card p-6 md:p-8 prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </motion.div>
  );
};

export default SummaryViewer;
