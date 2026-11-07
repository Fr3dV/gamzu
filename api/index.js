// API des scores gamzu.fr — Cloud Run (projet gamzu-fr) + Firestore.
//   GET  /scores?jeu=fz&n=10            → top n (un score par joueur : son meilleur)
//   POST /scores {jeu, nom, score, detail?} → enregistre, renvoie rang et meilleur score
// Stockage : jeux/{jeu}/joueurs/{nom en minuscules} = {nom, score, detail, parties, date}
// detail : court texte affiché à côté du score (palier atteint dans Terraforme).
//
// Mesure d'audience anonyme (aucun cookie, aucune IP ni pseudo enregistrés : que des compteurs) :
//   POST /evt {type, jeu, duree?}   type = visite | partie | fin (duree en secondes, avec fin)
//   GET  /stats?jours=30            → compteurs par jour (en-tête Authorization: Bearer STATS_TOKEN)
// Stockage : stats/{AAAA-MM-JJ, heure de Paris} = {fz_visite: 12, fz_partie: 8, fz_fin: 6, fz_duree: 1840, fz_scores: 5, …}
const http = require('http');
const { Firestore, FieldValue, FieldPath } = require('@google-cloud/firestore');

const db = new Firestore();

// Jeux acceptés et plafond de score plausible pour chacun.
const JEUX = {
  fz: { nom: 'Front Zéro', max: 5_000_000 },
  gxf: { nom: 'Guerre X Force', max: 40_000 },      // mode Combat : XP + bonus de victoire
  tf: { nom: 'Terraforme', max: 50_000_000 },       // indice de terraformation
  cnt: { nom: 'Chasse-Neige Tycoon', max: 500_000_000 }, // total d'euros gagnés
  lgc: { nom: 'La Grande Chasse', max: 100_000_000 },    // total d'argent gagné
};

// Sites suivis par la mesure d'audience (portail = gamzu.fr).
const SITES = new Set(['portail', 'fz', 'gxf', 'tf', 'cnt', 'lgc']);
const TYPES = new Set(['visite', 'partie', 'fin']);
const DUREE_MAX = 3 * 3600; // une durée plus longue est un onglet oublié : ignorée

const ORIGINES = /^https:\/\/([a-z0-9-]+\.)?gamzu\.fr$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// Limite d'envois par IP (en mémoire, par instance : suffisant à cette échelle).
const FENETRE_MS = 10 * 60 * 1000, MAX_ENVOIS = 30;
const envois = new Map();
function tropDEnvois(ip) {
  const now = Date.now();
  const liste = (envois.get(ip) || []).filter(t => now - t < FENETRE_MS);
  liste.push(now);
  envois.set(ip, liste);
  if (envois.size > 5000) for (const [k, v] of envois) if (now - v[v.length - 1] > FENETRE_MS) envois.delete(k);
  return liste.length > MAX_ENVOIS;
}

// Limite plus large pour les événements d'audience (une page en envoie plusieurs).
const MAX_EVTS = 120;
const evts = new Map();
function tropDEvts(ip) {
  const now = Date.now();
  const liste = (evts.get(ip) || []).filter(t => now - t < FENETRE_MS);
  liste.push(now);
  evts.set(ip, liste);
  if (evts.size > 5000) for (const [k, v] of evts) if (now - v[v.length - 1] > FENETRE_MS) evts.delete(k);
  return liste.length > MAX_EVTS;
}

const jourParis = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); // AAAA-MM-JJ
// Incrémente des compteurs du jour : { fz_visite: 1 } → stats/2026-11-07.fz_visite += 1
function compter(compteurs) {
  const maj = {};
  for (const [k, v] of Object.entries(compteurs)) maj[k] = FieldValue.increment(v);
  return db.collection('stats').doc(jourParis()).set(maj, { merge: true });
}

async function lireStats(jours) {
  const debut = new Date(Date.now() - (jours - 1) * 86400000);
  const snap = await db.collection('stats')
    .where(FieldPath.documentId(), '>=', jourParis(debut)).get();
  return snap.docs.map(d => ({ jour: d.id, ...d.data() })).sort((a, b) => a.jour.localeCompare(b.jour));
}

function nettoyerNom(n) {
  if (typeof n !== 'string') return null;
  n = n.normalize('NFC').replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim();
  return n.length >= 2 && n.length <= 16 ? n : null;
}
function nettoyerDetail(d) {
  if (typeof d !== 'string') return null;
  d = d.normalize('NFC').replace(/[^\p{L}\p{N} '’,.:\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
  return d || null;
}
const cleNom = n => n.toLowerCase().replace(/[\/\s.]/g, '_');
// Firestore réserve les identifiants de la forme __xxx__.
const cleValide = c => !/^__.*__$/.test(c);

const joueurs = jeu => db.collection('jeux').doc(jeu).collection('joueurs');

// Top 50 gardé en mémoire par jeu : au plus une requête Firestore toutes les CACHE_MS
// par instance, quel que soit le trafic. Les requêtes simultanées partagent la même lecture.
const TOP_MAX = 50, CACHE_MS = 15 * 1000;
const cache = new Map(); // jeu → { t, promesse }
async function lireTop(jeu) {
  const snap = await joueurs(jeu).orderBy('score', 'desc').limit(TOP_MAX).get();
  return snap.docs.map(d => { const x = d.data(); return { nom: x.nom, score: x.score, detail: x.detail || null, date: x.date.toDate().toISOString() }; });
}
async function top(jeu, n) {
  let c = cache.get(jeu);
  if (!c || Date.now() - c.t > CACHE_MS) {
    c = { t: Date.now(), promesse: lireTop(jeu) };
    cache.set(jeu, c);
    c.promesse.catch(() => { if (cache.get(jeu) === c) cache.delete(jeu); });
  }
  return (await c.promesse).slice(0, n);
}

async function enregistrer(jeu, nom, score, detail) {
  const ref = joueurs(jeu).doc(cleNom(nom));
  const { meilleur, record } = await db.runTransaction(async tx => {
    const doc = await tx.get(ref);
    const avant = doc.exists ? doc.data().score : -1;
    if (score > avant) {
      tx.set(ref, { nom, score, detail, date: FieldValue.serverTimestamp(), parties: FieldValue.increment(1) }, { merge: true });
      return { meilleur: score, record: true };
    }
    tx.update(ref, { parties: FieldValue.increment(1) });
    return { meilleur: avant, record: false };
  });
  if (record) cache.delete(jeu); // le joueur voit son score tout de suite
  compter({ [jeu + '_scores']: 1 }).catch(e => console.error('stats', e));
  const [devant, total] = await Promise.all([
    joueurs(jeu).where('score', '>', meilleur).count().get(),
    joueurs(jeu).count().get(),
  ]);
  return { meilleur, record, rang: devant.data().count + 1, total: total.data().count };
}

function repondre(res, code, corps) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(corps));
}

function lireCorps(req) {
  return new Promise((ok, ko) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 2000) { ko(new Error('trop gros')); req.destroy(); } });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { ko(e); } });
    req.on('error', ko);
  });
}

http.createServer(async (req, res) => {
  const origine = req.headers.origin;
  if (origine && ORIGINES.test(origine)) {
    res.setHeader('Access-Control-Allow-Origin', origine);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/scores' && req.method === 'GET') {
      const jeu = url.searchParams.get('jeu');
      if (!JEUX[jeu]) return repondre(res, 400, { erreur: 'jeu inconnu' });
      const n = Math.min(TOP_MAX, Math.max(1, parseInt(url.searchParams.get('n'), 10) || 10));
      res.setHeader('Cache-Control', 'public, max-age=15');
      return repondre(res, 200, { jeu, scores: await top(jeu, n) });
    }
    if (url.pathname === '/scores' && req.method === 'POST') {
      if (!origine || !ORIGINES.test(origine)) return repondre(res, 403, { erreur: 'origine refusée' });
      // Cloud Run ajoute l'IP réelle en DERNIÈRE position ; les entrées précédentes viennent du client.
      const ip = (req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress;
      if (tropDEnvois(ip)) return repondre(res, 429, { erreur: 'trop d’envois, réessaie plus tard' });
      const b = await lireCorps(req);
      const jeu = b.jeu, nom = nettoyerNom(b.nom), score = b.score, detail = nettoyerDetail(b.detail);
      if (!JEUX[jeu]) return repondre(res, 400, { erreur: 'jeu inconnu' });
      if (!nom || !cleValide(cleNom(nom))) return repondre(res, 400, { erreur: 'pseudo invalide (2 à 16 caractères)' });
      if (!Number.isInteger(score) || score < 0 || score > JEUX[jeu].max) return repondre(res, 400, { erreur: 'score invalide' });
      return repondre(res, 200, { jeu, nom, ...(await enregistrer(jeu, nom, score, detail)) });
    }
    if (url.pathname === '/evt' && req.method === 'POST') {
      if (!origine || !ORIGINES.test(origine)) return repondre(res, 403, { erreur: 'origine refusée' });
      const ip = (req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress;
      if (tropDEvts(ip)) return repondre(res, 429, { erreur: 'trop d’événements' });
      const b = await lireCorps(req);
      if (!SITES.has(b.jeu) || !TYPES.has(b.type)) return repondre(res, 400, { erreur: 'événement invalide' });
      const c = { [b.jeu + '_' + b.type]: 1 };
      if (b.type === 'fin') {
        const duree = Math.round(b.duree);
        if (!(duree > 0 && duree <= DUREE_MAX)) return repondre(res, 400, { erreur: 'durée invalide' });
        c[b.jeu + '_duree'] = duree;
      }
      await compter(c);
      res.writeHead(204); return res.end();
    }
    if (url.pathname === '/stats' && req.method === 'GET') {
      const jeton = process.env.STATS_TOKEN;
      if (!jeton) return repondre(res, 503, { erreur: 'STATS_TOKEN non configuré' });
      if ((req.headers.authorization || '') !== 'Bearer ' + jeton) return repondre(res, 401, { erreur: 'accès refusé' });
      const jours = Math.min(366, Math.max(1, parseInt(url.searchParams.get('jours'), 10) || 30));
      res.setHeader('Cache-Control', 'no-store');
      return repondre(res, 200, { jours: await lireStats(jours) });
    }
    if (url.pathname === '/') return repondre(res, 200, { ok: true, jeux: Object.keys(JEUX) });
    repondre(res, 404, { erreur: 'introuvable' });
  } catch (e) {
    console.error(e);
    repondre(res, 500, { erreur: 'erreur serveur' });
  }
}).listen(process.env.PORT || 8080);
