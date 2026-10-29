# AI Story Teller

Dashboard locale per organizzare il lavoro sui profili Instagram: account, progetti, personaggi, prompt,
episodi e inquadrature. Gira nel browser del tuo computer; nessun collegamento ai social.

## Avvio

Doppio clic su `start.bat`. Al primo avvio installa le dipendenze e prepara l'interfaccia, poi apre
<http://localhost:5178>. Per fermarlo chiudi la finestra nera.

Serve Node.js 24 o successivo (usa il database SQLite integrato in Node).

## Cosa contiene

- **Account Instagram**, anche satellite (es. il profilo di un personaggio legato all'account principale).
- **Progetti** di tre tipi:
  - *Progetto base*: post, prompt, calendario, idee.
  - *Progetto con personaggi*: carte personaggio, episodi, inquadrature, copioni, bibbia della serie.
  - *AI Influencer*: la persona del profilo, linee guida (tono, pilastri, cose da non fare), post.
- **Carta personaggio**: scheda immagine con varianti, descrizione fissa da incollare nei prompt, regole di
  continuità, voce (ElevenLabs), arco narrativo. Si può stampare.
- **Composer di prompt**: prefisso di stile + descrizioni fisse dei personaggi + scena, con l'elenco delle
  immagini di riferimento da allegare; prompt video con regole di continuità e riga `Avoid:`.
- **Storico dei prompt**: quando cambi il prompt di un'inquadratura, la versione precedente resta nello storico.
  Ogni prompt ha strumento, parametri, esito e valutazione.
- **Tavolo delle inquadrature** per episodio: fotogrammi 9:16 con stato (da generare → immagine ok → video ok →
  montato), anteprime di immagini e video, riepilogo animazioni.
- **Copione e mappa di montaggio**, con export `timeline.csv` e dell'episodio in markdown.
- **Calendario editoriale** (trascina per pianificare), **idee** in bacheca (Ctrl K ovunque per annotarne una),
  **ricerca** globale, **metriche** inserite a mano.
- **Import di una serie** da un documento di stagione (es. `Bank_error_S1_copioni_e_prompt.txt`) e **scanner**
  che collega i file `EPxx_Syy.png` / `EPxx_Syy_VID.mp4` alle inquadrature.

## Dati

- Archivio: `data/storyteller.db`. Ogni giorno, all'avvio, una copia va in `data/backups/` (ultime 14).
- File caricati dall'app: `data/media/`.
- I file collegati dal disco restano dove sono: l'app li legge soltanto, solo dentro le cartelle elencate in
  `config.json` → `allowedRoots`. Aggiungi lì altre cartelle se servono.
- Da *Import e backup* puoi scaricare e ripristinare un backup completo in JSON.

## Sviluppo

```
npm run dev        # server + Vite con ricarica automatica (http://localhost:5173)
npm test           # test del parser e dello scanner
npm run typecheck
npm run build      # rigenera dist/ dopo modifiche all'interfaccia
```
