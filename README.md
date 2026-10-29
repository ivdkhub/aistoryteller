# AI Story Teller

Dashboard locale per organizzare il lavoro sui profili Instagram: account, progetti, personaggi, prompt,
episodi e inquadrature. Gira nel browser del tuo computer; nessun collegamento ai social.

## Avvio

1. Installa **Node.js 22.18 o successivo** (versione LTS da <https://nodejs.org>).
2. Doppio clic su `start.bat`.

Al primo avvio installa le dipendenze e prepara l'interfaccia (circa 15 secondi), poi apre
<http://localhost:5178>. Agli avvii successivi ricompila l'interfaccia solo se è stata aggiornata. Se l'app è
già aperta, `start.bat` apre solo il browser. Per fermarla chiudi la finestra nera.

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
- I file collegati dal disco restano dove sono: l'app li legge soltanto, e solo dentro le **cartelle dei
  contenuti** (di default la cartella utente). Si cambiano da *Import e backup → Cartelle dei contenuti*.
- Da *Import e backup* puoi scaricare e ripristinare un backup completo in JSON.

## Impostazioni

`config.json` contiene i valori di partenza distribuiti con l'app. Le impostazioni di questo PC stanno in
`config.local.json` (creato dall'app, non va condiviso), ad esempio:

```json
{ "port": 5179, "allowedRoots": ["C:\\Users\\nome\\Documenti\\Contenuti"] }
```

Le API rispondono solo a richieste da questo computer (`localhost`) e dalla pagina dell'app.

## Claude Code (server MCP)

AI Story Teller include un server MCP: Claude Code può usare ogni funzione dell'app da qualsiasi cartella, e
l'app aperta nel browser mostra le modifiche entro pochi secondi.

Registrazione (una volta sola, per tutte le cartelle):

```
claude mcp add --scope user ai-story-teller -- node "<cartella di AI Story Teller>\server\mcp.ts"
```

Aperto in questa cartella, Claude Code lo trova anche da `.mcp.json`.

Strumenti: `panoramica`, `schema_campi`, `albero_progetto`, `elenca`, `leggi` (anche per codice, es. `EP02_S07`),
`cerca`, `avanzamento_episodio`, `crea`, `modifica`, `elimina`, `crea_struttura` (un progetto intero in un colpo
solo, rilanciabile senza doppioni), `componi_prompt`, `importa_serie`, `scansiona_cartella`, `esporta_episodio`,
`piano_cartelle`, `crea_cartelle`, `esporta_backup`.

Comandi pronti in Claude Code:

- `/mcp__ai-story-teller__importa_cartella` — legge una cartella di lavoro locale e la porta nell'app.
- `/mcp__ai-story-teller__prepara_cartelle` — crea le cartelle locali di un progetto leggendo dall'app.

Esempi di richieste:

- "Nell'EP03 di Bank Error cambia la caption e segna la voce come fatta."
- "Crea su AI Story Teller un nuovo progetto AI Influencer per @margot con persona, 3 stili e 5 post."
- "Ho sviluppato l'idea in questa cartella: importala nell'account Reel Riot."
- "Preparami le cartelle del progetto in C:\Spazio di lavoro\ivdk\Contenuti."

## Sviluppo

```
npm run dev        # server + Vite con ricarica automatica (http://localhost:5173)
npm test           # test unitari (parser, scanner, avanzamento, strutture e cartelle)
npm run test:e2e   # usa l'app in Edge/Chrome headless; E2E_SEASON=<documento> prova anche l'import
npm run typecheck
npm run build      # rigenera dist/ dopo modifiche all'interfaccia
```
