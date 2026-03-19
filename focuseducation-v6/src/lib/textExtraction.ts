import * as pdfjsLib from "pdfjs-dist";
import mammoth from "mammoth";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

/**
 * Normalize extracted text: strip metadata noise, collapse whitespace.
 * This ensures character count reflects ONLY readable content.
 */
function normalizeText(raw: string): string {
  return raw
    // Remove XML/HTML tags that may leak from docx/pdf
    .replace(/<[^>]+>/g, " ")
    // Remove common PDF artifact patterns (e.g., form feeds, null bytes)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    // Collapse runs of whitespace (spaces, tabs) into a single space
    .replace(/[ \t]+/g, " ")
    // Collapse more than 2 consecutive newlines into 2
    .replace(/\n{3,}/g, "\n\n")
    // Trim each line
    .split("\n").map(l => l.trim()).join("\n")
    .trim();
}

export async function extractTextFromPdf(arrayBuffer: ArrayBuffer): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Join items with space; items with hasEOL get a newline instead
    const pageText = content.items.map((item: any) =>
      item.hasEOL ? item.str + "\n" : item.str
    ).join(" ");
    pageTexts.push(pageText);
  }
  return normalizeText(pageTexts.join("\n"));
}

export async function extractTextFromDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  const result = await mammoth.extractRawText({ arrayBuffer });
  return normalizeText(result.value);
}

export async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.toLowerCase().substring(file.name.lastIndexOf("."));
  if (ext === ".pdf") return extractTextFromPdf(await file.arrayBuffer());
  if (ext === ".docx" || ext === ".doc") return extractTextFromDocx(await file.arrayBuffer());
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(normalizeText(ev.target?.result as string || ""));
    reader.onerror = () => reject(new Error("Errore lettura file"));
    reader.readAsText(file);
  });
}
