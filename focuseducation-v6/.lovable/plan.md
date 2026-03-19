

# Aggiungere Upload Foto a Studio AI

## Cosa viene aggiunto
Un nuovo tab "Foto" nel selettore di input di Studio AI che permette di caricare una o piu immagini (JPG, PNG, WEBP). Le immagini vengono convertite in base64 e inviate al modello AI (Gemini 2.5 Flash, che supporta input multimodale) per generare quiz, flashcard e mappe concettuali direttamente dalle foto di appunti, slide, lavagne, pagine di libro, ecc.

## Come funziona

1. **Nuovo tab "Foto"** accanto a "Carica file" e "Incolla testo"
2. Upload multiplo con anteprima thumbnail e possibilita di rimuovere singole immagini
3. Limite: max 5 immagini, max 5MB ciascuna
4. Le immagini vengono convertite in base64 lato client
5. Inviate all'edge function come array di data URL
6. L'edge function le inserisce nei messaggi AI come content parts multimodali (formato OpenAI-compatible)

## Dettagli tecnici

### Frontend - `src/components/study/DocumentUpload.tsx`
- Aggiungere terzo tab "Foto" nel selettore input mode (`"file" | "text" | "images"`)
- Stato `images: { file: File, preview: string, base64: string }[]`
- Input file con `accept="image/*"` e `multiple`
- Griglia di anteprima con pulsante X per rimuovere
- Conversione a base64 via `FileReader.readAsDataURL`
- Quando ci sono immagini, il pulsante genera invia le immagini al posto del testo
- Modificare la chiamata `fetch` a `generate-study-content` per includere un campo `images: string[]` (array di data URL base64)

### Backend - `supabase/functions/generate-study-content/index.ts`
- Accettare il nuovo campo `images` dal body della request
- Quando sono presenti immagini (e nessun testo), costruire i messaggi AI con content parts multimodali:
  ```
  { role: "user", content: [
    { type: "text", text: "prompt..." },
    { type: "image_url", image_url: { url: "data:image/jpeg;base64,..." } },
    ...
  ]}
  ```
- Quando ci sono sia immagini che testo, combinare entrambi
- Per le immagini non si usa il chunking (il modello le analizza direttamente)
- Usare il modello `google/gemini-2.5-flash` che supporta input multimodale

### File modificati
1. `src/components/study/DocumentUpload.tsx` - UI upload immagini, conversione base64, invio
2. `supabase/functions/generate-study-content/index.ts` - Gestione input multimodale nelle chiamate AI

