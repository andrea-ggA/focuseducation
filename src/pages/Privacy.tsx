import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

const S = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <section id={id} className="scroll-mt-4">
    {children}
  </section>
);

const Privacy = () => (
  <div className="min-h-screen bg-background">
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Torna alla home
      </Link>

      <h1 className="text-3xl font-bold text-foreground mb-2">Informativa sulla Privacy</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Ai sensi del Regolamento UE 2016/679 (GDPR) — Ultimo aggiornamento: Marzo 2026
      </p>

      <div className="prose prose-sm text-muted-foreground space-y-8">

        <S id="titolare">
          <h2 className="text-lg font-semibold text-foreground">1. Titolare del trattamento</h2>
          <p>
            Il titolare del trattamento è <strong>FocusED</strong>. Per esercitare i tuoi diritti o per qualsiasi domanda
            relativa alla privacy, contattaci tramite la sezione <strong>Assistenza</strong> nel tuo profilo
            o all'indirizzo email indicato nella stessa sezione.
          </p>
        </S>

        <S id="dati">
          <h2 className="text-lg font-semibold text-foreground">2. Categorie di dati raccolti</h2>
          <p>Raccogliamo le seguenti categorie di dati personali:</p>

          <h3 className="text-base font-medium text-foreground mt-4">Dati forniti direttamente</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>Nome e indirizzo email (registrazione)</li>
            <li>Livello di istruzione e obiettivi di studio (onboarding opzionale)</li>
            <li>Data e materia di esame (opzionale)</li>
            <li>Documenti, note e materiale didattico caricato per la generazione AI</li>
          </ul>

          <h3 className="text-base font-medium text-foreground mt-4">Dati sulla salute — categoria speciale (Art. 9 GDPR)</h3>
          <p>
            Raccogliamo in modo opzionale informazioni relative al livello di distrazione dell'utente
            (es. "mi distraggo spesso") nell'ambito del profilo ADHD. Questi dati rientrano nella categoria
            delle <strong>informazioni sulla salute</strong> ai sensi dell'Art. 9 GDPR e vengono trattati
            esclusivamente sulla base del <strong>consenso esplicito</strong> dell'utente, fornito durante
            l'onboarding. Puoi revocare il consenso in qualsiasi momento cancellando il profilo ADHD
            dalla sezione Impostazioni.
          </p>

          <h3 className="text-base font-medium text-foreground mt-4">Dati di utilizzo</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>Sessioni di studio e focus completate</li>
            <li>Quiz, flashcard e riassunti generati</li>
            <li>Risposte ai quiz e progressi di apprendimento</li>
            <li>NeuroCredits utilizzati</li>
          </ul>

          <h3 className="text-base font-medium text-foreground mt-4">Dati di pagamento</h3>
          <p>
            I dati di pagamento (carta di credito, conto PayPal) vengono gestiti interamente da
            <strong> PayPal</strong>. FocusED non memorizza né ha accesso ai dati finanziari completi —
            riceviamo solo la conferma di avvenuto pagamento e un identificativo di transazione.
          </p>
        </S>

        <S id="finalita">
          <h2 className="text-lg font-semibold text-foreground">3. Finalità e basi giuridiche</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 font-semibold text-foreground">Finalità</th>
                  <th className="text-left py-2 font-semibold text-foreground">Base giuridica</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  ["Erogazione del servizio (generazione AI, studio)", "Esecuzione del contratto (Art. 6.1.b)"],
                  ["Gestione abbonamenti e pagamenti", "Esecuzione del contratto (Art. 6.1.b)"],
                  ["Email transazionali (ricevute, notifiche account)", "Esecuzione del contratto (Art. 6.1.b)"],
                  ["Personalizzazione ADHD del profilo", "Consenso esplicito (Art. 9.2.a)"],
                  ["Analisi aggregate per migliorare il servizio", "Legittimo interesse (Art. 6.1.f)"],
                  ["Email marketing (novità, offerte)", "Consenso (Art. 6.1.a) — revocabile"],
                  ["Adempimenti fiscali e legali", "Obbligo legale (Art. 6.1.c)"],
                ].map(([f, b]) => (
                  <tr key={f}>
                    <td className="py-2 pr-4">{f}</td>
                    <td className="py-2">{b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </S>

        <S id="ai">
          <h2 className="text-lg font-semibold text-foreground">4. Trattamento AI e documenti caricati</h2>
          <p>
            I documenti che carichi (PDF, DOCX, testo) vengono inviati al nostro backend sicuro e quindi
            all'API di <strong>Google Gemini</strong> per la generazione di quiz, flashcard e riassunti.
            I documenti vengono elaborati in tempo reale e <strong>non vengono conservati</strong> da Google
            per scopi di addestramento del modello (Google Cloud API Agreement, Data Processing Addendum).
            Una copia del testo estratto viene temporaneamente memorizzata nel nostro database per permettere
            la rigenerazione del contenuto dallo stesso documento.
          </p>
          <p className="mt-2">
            Puoi eliminare qualsiasi contenuto generato in qualsiasi momento dalla sezione <strong>Libreria</strong>.
          </p>
        </S>

        <S id="conservazione">
          <h2 className="text-lg font-semibold text-foreground">5. Conservazione dei dati</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Dati di account:</strong> per tutta la durata dell'account e fino a 30 giorni dopo la cancellazione</li>
            <li><strong>Contenuti generati (quiz, flashcard):</strong> fino a cancellazione da parte dell'utente</li>
            <li><strong>Dati di pagamento e transazioni:</strong> 10 anni (obbligo fiscale italiano)</li>
            <li><strong>Log di sistema:</strong> 90 giorni</li>
            <li><strong>Dati ADHD (categoria speciale):</strong> eliminati immediatamente su richiesta o alla cancellazione dell'account</li>
          </ul>
        </S>

        <S id="terze-parti">
          <h2 className="text-lg font-semibold text-foreground">6. Condivisione con terze parti</h2>
          <p>Non vendiamo i tuoi dati. Li condividiamo solo con i seguenti fornitori di servizi essenziali:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li><strong>Supabase</strong> (database e autenticazione) — EU/US, Standard Contractual Clauses</li>
            <li><strong>Google Cloud / Gemini API</strong> (elaborazione AI) — Data Processing Addendum attivo</li>
            <li><strong>PayPal</strong> (pagamenti) — soggetto al proprio regime di conformità PCI-DSS</li>
            <li><strong>Google Cloud Run</strong> (hosting backend) — EU region (europe-west1)</li>
          </ul>
        </S>

        <S id="diritti">
          <h2 className="text-lg font-semibold text-foreground">7. I tuoi diritti (GDPR)</h2>
          <p>Hai il diritto di:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li><strong>Accesso</strong> (Art. 15): ricevere copia dei tuoi dati personali</li>
            <li><strong>Rettifica</strong> (Art. 16): correggere dati inesatti</li>
            <li><strong>Cancellazione</strong> (Art. 17): "diritto all'oblio" — eliminiamo tutti i tuoi dati entro 30 giorni</li>
            <li><strong>Portabilità</strong> (Art. 20): ricevere i tuoi dati in formato strutturato (JSON/CSV)</li>
            <li><strong>Opposizione</strong> (Art. 21): opporti al trattamento per legittimo interesse</li>
            <li><strong>Revoca del consenso</strong> (Art. 7.3): in qualsiasi momento, senza penali</li>
            <li><strong>Limitazione</strong> (Art. 18): richiedere la sospensione temporanea del trattamento</li>
          </ul>
          <p className="mt-3">
            Per esercitare qualsiasi diritto, contattaci dall'interno della piattaforma (Profilo → Assistenza).
            Rispondiamo entro <strong>30 giorni</strong>. Puoi anche proporre reclamo all'
            <strong>Autorità Garante per la Protezione dei Dati Personali</strong> (www.garanteprivacy.it).
          </p>
        </S>

        <S id="minori">
          <h2 className="text-lg font-semibold text-foreground">8. Minori</h2>
          <p>
            FocusED è destinato a utenti di età pari o superiore a <strong>16 anni</strong>. Non raccogliamo
            consapevolmente dati di minori di 16 anni. Se sei genitore o tutore e ritieni che tuo figlio
            abbia creato un account, contattaci per la cancellazione immediata.
          </p>
        </S>

        <S id="cookie">
          <h2 className="text-lg font-semibold text-foreground">9. Cookie e tecnologie di tracciamento</h2>
          <p>
            Utilizziamo esclusivamente cookie tecnici essenziali per il funzionamento del servizio
            (autenticazione, preferenze di sessione). Non utilizziamo cookie di profilazione né di
            tracciamento pubblicitario di terze parti.
          </p>
        </S>

        <S id="modifiche">
          <h2 className="text-lg font-semibold text-foreground">10. Modifiche a questa informativa</h2>
          <p>
            In caso di modifiche sostanziali ti notificheremo via email con almeno 15 giorni di preavviso.
            La versione aggiornata sarà sempre disponibile a questa pagina con la data di ultimo aggiornamento.
          </p>
        </S>

        <p className="text-xs text-muted-foreground pt-4 border-t border-border">
          Ultimo aggiornamento: Marzo 2026 · Versione 2.0
        </p>
      </div>
    </div>
  </div>
);

export default Privacy;
