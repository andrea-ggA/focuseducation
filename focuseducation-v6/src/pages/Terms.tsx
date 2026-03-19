import { ArrowLeft } from "lucide-react";
import { Link } from "react-router-dom";

const Terms = () => (
  <div className="min-h-screen bg-background">
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Torna alla home
      </Link>

      <h1 className="text-3xl font-bold text-foreground mb-2">Termini di Servizio</h1>
      <p className="text-sm text-muted-foreground mb-8">Ultimo aggiornamento: Marzo 2026 — Versione 2.0</p>

      <div className="prose prose-sm text-muted-foreground space-y-8">

        <section>
          <h2 className="text-lg font-semibold text-foreground">1. Accettazione e ambito</h2>
          <p>
            Utilizzando FocusED accetti i presenti Termini di Servizio. Se non accetti, non utilizzare il servizio.
            Questi termini si applicano a tutti gli utenti registrati, inclusi gli utenti in periodo di prova gratuita.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">2. Descrizione del servizio</h2>
          <p>
            FocusED è una piattaforma di studio assistita dall'intelligenza artificiale, progettata per studenti
            con ADHD e difficoltà di attenzione. Il servizio include: generazione automatica di quiz, flashcard,
            mappe concettuali e riassunti da documenti caricati dall'utente; sistema di ripasso intelligente
            basato sull'algoritmo SM-2; timer Pomodoro adattivo; tutor AI; gamification e strumenti di produttività.
          </p>
          <p className="mt-2">
            <strong>Limitazione medica:</strong> FocusED è uno strumento didattico e di produttività.
            Non costituisce diagnosi, trattamento o consiglio medico per l'ADHD o qualsiasi altra condizione.
            Per diagnosi o trattamenti consulta uno specialista qualificato.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">3. Account e sicurezza</h2>
          <p>
            Per accedere alle funzionalità principali è necessario un account. Sei responsabile della
            riservatezza delle credenziali e di tutte le attività svolte con il tuo account. Notificaci
            immediatamente in caso di accesso non autorizzato. Non è consentita la condivisione dell'account
            con terzi.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">4. Piani, abbonamenti e NeuroCredits</h2>

          <h3 className="text-base font-medium text-foreground mt-3">Piano gratuito</h3>
          <p>
            Il piano gratuito include 15 NeuroCredits al mese, senza scadenza entro il mese di competenza.
            I crediti non si accumulano nel piano Free.
          </p>

          <h3 className="text-base font-medium text-foreground mt-3">Piani a pagamento</h3>
          <p>
            I piani Focus Pro e Hyperfocus Master si rinnovano automaticamente alla scadenza del periodo
            (mensile o annuale), addebitando il metodo di pagamento registrato tramite PayPal.
            Puoi cancellare il rinnovo automatico in qualsiasi momento dalla sezione <strong>Profilo → Piano</strong>,
            con effetto dal ciclo di fatturazione successivo.
          </p>

          <h3 className="text-base font-medium text-foreground mt-3">Trial gratuito</h3>
          <p>
            Il trial di 7 giorni di Hyperfocus Master è disponibile una sola volta per account.
            Non è richiesto un metodo di pagamento per attivarlo. Al termine del trial,
            l'account ritorna automaticamente al piano Free.
          </p>

          <h3 className="text-base font-medium text-foreground mt-3">NeuroCredits</h3>
          <p>
            I NeuroCredits sono la valuta interna per l'utilizzo delle funzionalità AI. I crediti mensili
            del piano non utilizzati decadono a fine mese (piano Free) o vengono parzialmente riportati
            al mese successivo (piani a pagamento, fino al 50% dell'allowance mensile).
            I pacchetti crediti acquistati separatamente non scadono.
          </p>
        </section>

        <section id="rimborsi">
          <h2 className="text-lg font-semibold text-foreground">5. Politica di rimborso</h2>
          <p>
            Ai sensi dell'Art. 59, lett. a) del Codice del Consumo (D.Lgs. 206/2005) e della
            Direttiva UE 2011/83/UE, il diritto di recesso di 14 giorni <strong>non si applica</strong>
            ai contenuti digitali forniti immediatamente con il consenso esplicito dell'utente.
            Confermando l'acquisto accetti la fornitura immediata del servizio e la conseguente
            rinuncia al diritto di recesso.
          </p>
          <p className="mt-2">
            In via eccezionale, riconosciamo un rimborso entro 7 giorni dall'acquisto se il servizio
            presenta malfunzionamenti gravi e documentati che ne impediscano l'utilizzo, e solo per
            il primo acquisto di ciascun piano. Per richiedere un rimborso, contattaci tramite
            Profilo → Assistenza con oggetto "Rimborso".
          </p>
          <p className="mt-2">
            I pacchetti NeuroCredits e i crediti già parzialmente utilizzati non sono rimborsabili.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">6. Contenuti generati dall'AI</h2>
          <p>
            I contenuti generati da FocusED (quiz, flashcard, riassunti, mappe concettuali) sono prodotti
            da modelli di intelligenza artificiale e potrebbero contenere inesattezze, errori o informazioni
            incomplete. Ti invitiamo sempre a verificare i contenuti con fonti autorevoli prima di utilizzarli
            per preparare esami o prendere decisioni importanti.
          </p>
          <p className="mt-2">
            I contenuti generati a partire da materiale da te caricato sono concessi in licenza d'uso
            personale e non commerciale. Non è consentita la rivendita, la distribuzione commerciale o
            l'utilizzo per addestrare altri modelli di AI.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">7. Condotta degli utenti</h2>
          <p>È vietato utilizzare FocusED per:</p>
          <ul className="list-disc pl-5 space-y-1 mt-2">
            <li>Caricare materiale protetto da copyright senza autorizzazione</li>
            <li>Generare contenuti offensivi, illegali o discriminatori</li>
            <li>Tentare di aggirare i limiti di credito o di accedere a funzionalità non acquistate</li>
            <li>Utilizzare strumenti automatizzati per generare contenuti in modo massiccio (scraping)</li>
            <li>Condividere credenziali di accesso o rivendere l'accesso al servizio</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">8. Proprietà intellettuale</h2>
          <p>
            I documenti e i materiali che carichi rimangono di tua proprietà. Ci concedi una licenza
            limitata, non esclusiva e revocabile per elaborarli al solo scopo di fornire il servizio.
            Il codice sorgente, il design, i marchi e i contenuti originali di FocusED sono di
            proprietà esclusiva di FocusED e protetti dalle leggi sul diritto d'autore.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">9. Disponibilità e limitazione di responsabilità</h2>
          <p>
            FocusED è fornito "così com'è". Ci impegniamo a garantire un uptime del 99%, ma non
            possiamo garantire che il servizio sia privo di interruzioni o errori. In nessun caso
            saremo responsabili per danni indiretti, perdita di dati, perdita di opportunità o danni
            derivanti dall'affidamento ai contenuti generati dall'AI.
          </p>
          <p className="mt-2">
            La nostra responsabilità massima è limitata all'importo pagato negli ultimi 3 mesi di abbonamento.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">10. Cancellazione dell'account</h2>
          <p>
            Puoi cancellare il tuo account in qualsiasi momento da Profilo → Impostazioni → Cancella account.
            La cancellazione è definitiva: tutti i dati, i contenuti generati e i crediti residui
            saranno eliminati entro 30 giorni. I dati di transazione vengono conservati per 10 anni
            per obblighi fiscali.
          </p>
          <p className="mt-2">
            Ci riserviamo il diritto di sospendere o cancellare account che violino i presenti Termini,
            con preavviso di 48 ore salvo casi gravi (frode, violazione di legge).
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">11. Legge applicabile e foro competente</h2>
          <p>
            I presenti Termini sono regolati dalla legge italiana. Per qualsiasi controversia è
            competente il Foro del luogo di residenza o domicilio del consumatore ai sensi del
            Codice del Consumo italiano. Per gli utenti non consumatori (aziende) è competente
            il Foro di Milano.
          </p>
          <p className="mt-2">
            Per la risoluzione alternativa delle controversie (ADR/ODR), puoi fare riferimento alla
            piattaforma ODR della Commissione Europea: <span className="text-primary">ec.europa.eu/consumers/odr</span>
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-foreground">12. Modifiche ai termini</h2>
          <p>
            Ci riserviamo il diritto di modificare questi termini. Le modifiche sostanziali saranno
            comunicate via email con almeno <strong>15 giorni</strong> di preavviso. L'utilizzo continuato
            del servizio dopo tale periodo costituisce accettazione delle modifiche.
          </p>
        </section>

        <p className="text-xs text-muted-foreground pt-4 border-t border-border">
          Ultimo aggiornamento: Marzo 2026 · Versione 2.0
        </p>
      </div>
    </div>
  </div>
);

export default Terms;
