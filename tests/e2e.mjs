// Test end-to-end dell'interfaccia: avvia il server su un archivio temporaneo e usa l'app con Edge/Chrome headless.
// Uso: npm run test:e2e   (variabili: E2E_SEASON = documento di stagione da importare, E2E_SHOTS = cartella screenshot)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5197;
const BASE = `http://localhost:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'storyteller-e2e-'));
const SHOTS = process.env.E2E_SHOTS ?? path.join(DATA, 'screenshot');
const SEASON = process.env.E2E_SEASON ?? '';
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(`OK    ${name}`);
  } catch (err) {
    failures++;
    results.push(`FAIL  ${name}\n      ${String(err.message).split('\n')[0]}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// --- Server ---
const server = spawn(process.execPath, ['server/index.ts'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), STORYTELLER_DATA: DATA, OPEN_BROWSER: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`${BASE}/api/config`)).ok) break;
  } catch {
    await new Promise((r) => setTimeout(r, 200));
  }
}

// --- Browser ---
const channels = ['msedge', 'chrome'];
let browser;
for (const channel of channels) {
  try {
    browser = await chromium.launch({ channel, headless: true });
    break;
  } catch {
    // prova il prossimo
  }
}
if (!browser) {
  console.error('Nessun browser trovato (serve Microsoft Edge o Google Chrome).');
  server.kill();
  process.exit(1);
}
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'it-IT' });
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text()) && consoleErrors.push(`${page.url()} — ${m.text()}`));
page.on('pageerror', (e) => consoleErrors.push(`${page.url()} — ${e.message}`));
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const settle = () => page.waitForTimeout(900); // attende il salvataggio automatico (700 ms)

await step('Benvenuto al primo avvio', async () => {
  await page.goto(BASE);
  await page.getByRole('heading', { name: 'Il tuo studio per i contenuti Instagram' }).waitFor();
  await shot('01-benvenuto');
});

await step('Crea un account dalla barra laterale', async () => {
  await page.getByRole('button', { name: 'Nuovo account' }).click();
  await page.getByPlaceholder('Es. Bank Error').fill('Profilo di prova');
  await page.getByPlaceholder('@nomeprofilo').fill('provaprofilo');
  await page.getByRole('button', { name: 'Crea account' }).click();
  await page.getByRole('heading', { name: 'Profilo di prova' }).waitFor();
  assert(await page.locator('.nav-account', { hasText: '@provaprofilo' }).isVisible(), 'handle senza @ non normalizzato');
});

await step('Foto profilo e account nel Dock', async () => {
  const accountUrl = page.url();
  // PNG 1x1 rosso
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({ name: 'profilo.png', mimeType: 'image/png', buffer: png });
  await page.locator('.dock .dock-account img').waitFor();
  await page.locator('.nav-account .avatar img').waitFor();
  await settle();
  await page.locator('.dock-item[aria-label="Calendario"]').click();
  await page.waitForURL(/\/calendario$/);
  await page.locator('.dock .dock-item', { has: page.locator('.dock-account') }).first().click();
  await page.waitForURL(accountUrl);
  await page.getByRole('heading', { name: 'Profilo di prova' }).waitFor();
  await page.reload();
  await page.locator('.page-head .avatar img').waitFor();
  await shot('01b-foto-profilo-dock');
});

const projectUrls = {};
for (const [type, label] of [['base', 'Progetto base'], ['characters', 'Progetto con personaggi'], ['ai_influencer', 'AI Influencer']]) {
  await step(`Crea un progetto "${label}"`, async () => {
    await page.locator('.nav-account', { hasText: 'Profilo di prova' }).click();
    await page.getByRole('button', { name: 'Nuovo progetto' }).click();
    await page.locator('.type-card', { hasText: label }).click();
    await page.locator('.modal input').last().fill(`Prova ${type}`);
    await page.getByRole('button', { name: 'Crea progetto' }).click();
    await page.getByRole('heading', { name: `Prova ${type}` }).waitFor();
    projectUrls[type] = page.url();
    const tabs = await page.getByRole('tab').allInnerTexts();
    const expected = { base: 'Post', characters: 'Bibbia', ai_influencer: 'Linee guida' }[type];
    assert(tabs.some((t) => t.startsWith(expected)), `scheda "${expected}" mancante: ${tabs.join(', ')}`);
    for (const t of tabs) {
      await page.getByRole('tab', { name: t }).click();
      await page.waitForTimeout(150);
    }
  });
}

await step('Carta personaggio: crea, modifica, salvataggio automatico', async () => {
  await page.goto(projectUrls.characters + '/personaggi');
  await page.getByRole('button', { name: 'Nuovo personaggio' }).click();
  await page.getByPlaceholder('Es. NICO DALE').fill('ANNA');
  await page.getByRole('button', { name: 'Crea personaggio' }).click();
  await page.locator('.char-name').waitFor();
  await page.getByPlaceholder('a 30-year-old man with curly dark-brown hair…').fill('a woman with red hair, green coat');
  await page.getByPlaceholder('Es. non mostra mai il volto').fill('mai di fronte');
  await page.getByRole('button', { name: 'Aggiungi' }).first().click();
  await settle();
  await page.reload();
  await page.locator('.char-name').waitFor();
  assert((await page.getByPlaceholder('a 30-year-old man with curly dark-brown hair…').inputValue()) === 'a woman with red hair, green coat', 'descrizione non salvata');
  assert((await page.locator('.list-editor input').first().inputValue()) === 'mai di fronte', 'regola non salvata');
  await shot('02-carta-personaggio');
});

await step('Episodio: inquadratura, prompt, avanzamento', async () => {
  await page.goto(projectUrls.characters + '/episodi');
  await page.getByRole('button', { name: 'Nuovo episodio' }).click();
  await page.locator('.modal input').first().fill('Pilot');
  await page.getByRole('button', { name: 'Crea episodio' }).click();
  await page.locator('.progress-line').waitFor();
  const before = await page.locator('.progress-line-head strong').innerText();
  await page.getByRole('button', { name: 'Nuova inquadratura' }).click();
  await page.locator('.drawer').waitFor();
  await page.getByPlaceholder('Cosa succede in questa inquadratura').fill('La porta si apre');
  await page.locator('.drawer .prompt-field textarea').first().fill('Cinematic still, a door opens.');
  await settle();
  await page.locator('.pl-step', { hasText: 'Voce e audio' }).locator('.pl-node').click();
  await settle();
  const after = await page.locator('.progress-line-head strong').innerText();
  assert(before !== after, `la percentuale non cambia (${before} → ${after})`);
  await page.reload();
  await page.locator('.drawer').waitFor();
  assert((await page.locator('.drawer .prompt-field textarea').first().inputValue()) === 'Cinematic still, a door opens.', 'prompt non salvato');
  await shot('03-episodio');
});

await step('Menu a tendina in stile macOS', async () => {
  const stato = page.locator('.episode-bar .field', { hasText: 'Stato' }).locator('.popup');
  await stato.click();
  const menu = page.locator('.popup-menu');
  await menu.waitFor();
  assert((await menu.locator('[aria-selected="true"]').innerText()).includes('✓'), 'manca la spunta sulla voce scelta');
  const [b, m] = [await stato.boundingBox(), await menu.locator('[aria-selected="true"]').boundingBox()];
  assert(Math.abs(b.y + b.height / 2 - (m.y + m.height / 2)) < 4, 'la voce scelta non è allineata al pulsante');
  await page.waitForTimeout(250);
  await shot('03b-menu-tendina');
  await menu.getByRole('option', { name: 'Scrittura' }).click();
  await menu.waitFor({ state: 'detached' });
  assert((await stato.innerText()) === 'Scrittura', 'scelta col mouse non applicata');
  await stato.focus();
  await page.keyboard.press('ArrowDown');
  await menu.waitFor();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await menu.waitFor({ state: 'detached' });
  const scelta = await stato.innerText();
  assert(scelta === 'In produzione', `scelta da tastiera non applicata (${scelta})`);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached' });
  assert(await page.locator('.drawer').isVisible(), 'Escape ha chiuso anche il pannello');
  await settle();
});

await step('Composer dei prompt dall\'inquadratura', async () => {
  await page.getByRole('button', { name: 'Componi' }).click();
  await page.locator('.composer').waitFor();
  await page.locator('.composer .chip', { hasText: 'ANNA' }).click();
  await page.getByPlaceholder('Over-the-shoulder shot from behind the protagonist…').fill('She opens the door.');
  const text = await page.locator('.composer .prompt-text').first().innerText();
  assert(text.includes('a woman with red hair') && text.includes('She opens the door.'), 'prompt composto errato');
  await shot('04-composer');
  await page.getByRole('button', { name: /^Usa per/ }).click();
  await page.locator('.composer').waitFor({ state: 'detached' });
  await settle();
  assert((await page.locator('.drawer .prompt-field textarea').first().inputValue()).includes('She opens the door.'), 'prompt non applicato');
});

await step('Schede dell\'episodio', async () => {
  for (const t of ['Copione e montaggio', 'Caption e voto', 'Revisioni e metriche', 'Storico prompt', 'Inquadrature']) {
    await page.getByRole('tab', { name: new RegExp(`^${t}`) }).click();
    await page.waitForTimeout(200);
  }
  await page.getByRole('tab', { name: /^Storico prompt/ }).click();
  await page.getByText('versione precedente').first().waitFor({ timeout: 3000 }).catch(() => {});
});

await step('Idee: cattura veloce con Ctrl+K e bacheca', async () => {
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Es. reel sul dietro le quinte del primo episodio').fill('Idea dal test');
  await page.getByRole('button', { name: 'Salva idea' }).click();
  await page.goto(`${BASE}/idee`);
  await page.locator('.idea-card', { hasText: 'Idea dal test' }).waitFor();
  await page.getByPlaceholder("Scrivi un'idea e premi Invio").fill('Seconda idea');
  await page.keyboard.press('Enter');
  await page.locator('.idea-card', { hasText: 'Seconda idea' }).waitFor();
});

await step('Calendario', async () => {
  await page.goto(`${BASE}/calendario`);
  await page.locator('.calendar').waitFor();
  await page.locator('.cal-unscheduled .cal-item').first().waitFor();
});

await step('Ricerca dalla barra degli strumenti', async () => {
  await page.locator('#toolbar-search').fill('red hair');
  await page.keyboard.press('Enter');
  await page.locator('.result', { hasText: 'ANNA' }).first().waitFor();
});

await step('Barra dei menu', async () => {
  await page.getByRole('button', { name: 'Vista' }).click();
  await page.getByRole('menuitem', { name: 'Calendario' }).click();
  await page.waitForURL(/calendario/);
  await page.getByRole('button', { name: 'AI Story Teller', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Informazioni su AI Story Teller' }).click();
  await page.getByText(/Versione \d/).waitFor();
  await page.keyboard.press('Escape');
});

if (SEASON && fs.existsSync(SEASON)) {
  await step('Import di una serie con anteprima', async () => {
    await page.goto(`${BASE}/import`);
    await page.getByPlaceholder(/Insta-series/).fill(SEASON);
    await page.getByRole('button', { name: 'Anteprima' }).click();
    await page.locator('.preview').waitFor();
    await page.getByRole('button', { name: 'Importa' }).click();
    await page.waitForURL(/\/progetto\/.+\/episodi/, { timeout: 30000 });
    await page.locator('tr', { hasText: 'EP02' }).first().click();
    await page.locator('.frame').first().waitFor();
    await page.waitForTimeout(1500);
    const loaded = await page.locator('.frame-img img').evaluateAll((imgs) => imgs.filter((i) => i.complete && i.naturalWidth > 0).length);
    assert(loaded > 10, `immagini delle inquadrature caricate: ${loaded}`);
    await shot('05-inquadrature-ep02');
    await page.locator('.frame').nth(4).click();
    await page.locator('.drawer').waitFor();
    await shot('06-inspector');
    await page.goto(`${BASE}/`);
    await page.locator('.project-card').first().waitFor();
    await shot('07-panoramica');
  });

  const api = (url, opts) => fetch(`${BASE}/api${url}`, opts).then((r) => r.json());
  const project = (await api('/items/project')).find((p) => p.title.startsWith('BANK'));
  const eps = project ? await api(`/items/episode?projectId=${project.id}`) : [];
  const ep2 = eps.find((e) => e.code === 'EP02');

  await step('Voti e rami: TRACE si propaga con il vincitore', async () => {
    await page.goto(`${BASE}/progetto/${project.id}/voti`);
    const node = (code) => page.locator('.story-node', { has: page.locator('.code', { hasText: new RegExp(`^${code}$`) }) });
    await node('EP02').locator('.state-chip', { hasText: 'TRACE 12%' }).waitFor();
    await node('EP02').locator('.vote-option', { hasText: 'MOVE' }).click();
    await node('EP03').locator('.state-chip', { hasText: 'TRACE 41%' }).waitFor();
    await shot('10-voti-e-rami');
    await node('EP02').locator('.vote-option', { hasText: 'MOVE' }).click();
    await node('EP03').locator('.state-chip', { hasText: 'TRACE ?' }).waitFor();
  });

  await step('Lista di generazione: copia e passa alla successiva', async () => {
    await page.goto(`${BASE}/progetto/${project.id}/generare`);
    await page.locator('.queue-card.active').waitFor();
    assert((await page.locator('.queue-card').count()) > 20, 'poche inquadrature in lista');
    const first = await page.locator('.queue-card.active .code').innerText();
    await page.getByRole('button', { name: /^Copia il prompt di/ }).click();
    await page.waitForTimeout(300);
    assert((await page.locator('.queue-card.active .code').innerText()) !== first, 'la lista non avanza');
    await page.getByRole('button', { name: /^Video da animare/ }).click();
    await page.locator('.queue-card').first().waitFor();
    await shot('11-da-generare');
  });

  await step('Galleria delle generazioni', async () => {
    const shots = await api(`/items/shot?projectId=${project.id}`);
    const withAlt = shots.find((s) => s.alternates.length >= 1 && s.imageFile);
    assert(withAlt, 'nessuna inquadratura con varianti');
    await page.goto(`${BASE}/episodio/${withAlt.episodeId}?shot=${withAlt.id}`);
    await page.locator('.gallery-strip').waitFor();
    await page.locator('.gallery-strip').getByRole('button', { name: 'Confronta' }).click();
    await page.locator('.gallery-card').first().waitFor();
    assert((await page.locator('.gallery-card').count()) >= 1, 'galleria vuota');
    await shot('12-galleria');
    await page.keyboard.press('Escape');
  });

  await step('Copione per ElevenLabs e pacchetto Remotion', async () => {
    const txt = await fetch(`${BASE}/api/episodes/${ep2.id}/export.elevenlabs`).then((r) => r.text());
    assert(txt.includes('BLOCCO A') && txt.includes('--- NICO'), 'copione ElevenLabs incompleto');
    const pack = await api(`/episodes/${ep2.id}/remotion`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dir: path.join(DATA, 'pack-ep02') }),
    });
    assert(pack.copied > 20 && fs.existsSync(path.join(DATA, 'pack-ep02', 'src', 'data', 'timeline.generated.ts')), `pacchetto: ${JSON.stringify(pack).slice(0, 200)}`);
    const outside = await fetch(`${BASE}/api/episodes/${ep2.id}/remotion`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dir: 'C:\\Windows\\Temp\\pack' }) });
    assert(outside.status === 403, `pacchetto fuori dalle cartelle consentite non bloccato (${outside.status})`);
    await page.goto(`${BASE}/episodio/${ep2.id}/copione`);
    await page.locator('.remotion-panel summary').click();
    await page.getByRole('button', { name: 'Crea il pacchetto' }).waitFor();
  });
}

await step('Controllo di coerenza: avviso su una regola violata', async () => {
  const api = (url, opts) => fetch(`${BASE}/api${url}`, { headers: { 'content-type': 'application/json' }, ...opts }).then((r) => r.json());
  const anna = (await api('/items/character')).find((c) => c.name === 'ANNA');
  await api(`/items/character/${anna.id}`, { method: 'PATCH', body: JSON.stringify({ continuityRules: ['non mostra mai il volto'] }) });
  const shotItem = (await api(`/items/shot?projectId=${anna.projectId}`))[0];
  await api(`/items/shot/${shotItem.id}`, { method: 'PATCH', body: JSON.stringify({ characterIds: [anna.id], imagePrompt: 'She turns to the camera, her face lit by the screen.' }) });
  await page.goto(`${BASE}/episodio/${shotItem.episodeId}?shot=${shotItem.id}`);
  await page.locator('.frame-warn').first().waitFor();
  await page.locator('.issue-warn').first().waitFor();
  await page.getByRole('button', { name: /da ricontrollare/ }).click();
  assert((await page.locator('.frame').count()) === 1, 'il filtro "da ricontrollare" non filtra');
  await shot('13-coerenza');
});

await step('Calendario settimanale: trascina su giorno e ora', async () => {
  await page.goto(`${BASE}/calendario`);
  await page.getByRole('button', { name: 'Settimana' }).click();
  await page.locator('.week').waitFor();
  const item = page.locator('.cal-unscheduled .cal-item').first();
  const title = await item.innerText();
  const target = page.locator('.week-cell').nth(7 * 5 + 2); // terza colonna, riga delle 10:00 (dopo "senza ora" e 6-9)
  await item.dragTo(target);
  await page.waitForTimeout(800);
  const eps = await fetch(`${BASE}/api/items/episode`).then((r) => r.json());
  const moved = eps.find((e) => title.includes(e.title) && e.publishDate);
  assert(moved && moved.publishDate.endsWith('T10:00'), `data non impostata: ${moved?.publishDate}`);
  await page.locator('.week-cell .cal-item').first().waitFor();
  await shot('14-settimana');
});

await step('Cartelle dei contenuti', async () => {
  await page.goto(`${BASE}/import`);
  await page.getByRole('heading', { name: 'Cartelle dei contenuti' }).waitFor();
});

await step('Tema scuro', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(projectUrls.characters + '/personaggi');
  await page.locator('.cast-card').first().waitFor();
  await shot('08-tema-scuro');
  await page.emulateMedia({ colorScheme: 'light' });
});

await step('Schermo stretto (telefono)', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/`);
  await page.locator('.window-toolbar').waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert(!overflow, 'scorrimento orizzontale sulla pagina');
  await shot('09-telefono');
  await page.setViewportSize({ width: 1440, height: 900 });
});

await step('Pagina inesistente e API protette', async () => {
  await page.goto(`${BASE}/progetto/inesistente`);
  await page.getByText('Progetto non trovato').waitFor();
  const res = await fetch(`${BASE}/api/items/account`, { headers: { Origin: 'http://evil.example' } });
  assert(res.status === 403, `richiesta da un altro sito non bloccata (${res.status})`);
  const file = await fetch(`${BASE}/api/file?path=${encodeURIComponent('C:\\Windows\\win.ini')}`);
  assert(file.status === 403, `file fuori dalle cartelle consentite non bloccato (${file.status})`);
});

await step('Nessun errore in console', async () => {
  // Il 404 della pagina inesistente è voluto.
  const real = consoleErrors.filter((e) => !e.includes('/inesistente'));
  assert(real.length === 0, real.slice(0, 5).join(' | '));
});

await browser.close();
server.kill();
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} passaggi riusciti. Screenshot in ${SHOTS}`);
if (failures) {
  console.log('\nLog del server:\n' + serverLog.slice(-2000));
  process.exit(1);
}
