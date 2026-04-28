import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import mammoth from "mammoth";

interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

/**
 * Normalize extracted text: strip metadata noise, collapse whitespace.
 * This ensures character count reflects ONLY readable content.
 */
function normalizeText(raw: string): string {
  const withoutControlChars = Array.from(raw).map((char) => {
    const code = char.charCodeAt(0);
    const isControlChar =
      (code >= 0x00 && code <= 0x08) ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f;
    return isControlChar ? " " : char;
  }).join("");
  return withoutControlChars
    // Remove XML/HTML tags that may leak from docx/pdf
    .replace(/<[^>]+>/g, " ")
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
    const pageText = (content.items as PdfTextItem[]).map((item) =>
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
