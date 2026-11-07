// API des scores gamzu.fr — Cloud Run (projet gamzu-fr) + Firestore.
//   GET  /scores?jeu=fz&n=10            → top n (un score par joueur : son meilleur)
//   POST /scores {jeu, nom, score, detail?} → enregistre, renvoie rang et meilleur score
// Stockage : jeux/{jeu}/joueurs/{nom en minuscules} = {nom, score, detail, parties, date}
// detail : court texte affiché à côté du score (palier atteint dans Terraforme).
const http = require('http');
const { Firestore, FieldValue } = require('@google-cloud/firestore');

const db = new Firestore();

// Jeux acceptés et plafond de score plausible pour chacun.
const JEUX = {
  fz: { nom: 'Front Zéro', max: 5_000_000 },
  gxf: { nom: 'Guerre X Force', max: 40_000 },      // mode Combat : XP + bonus de victoire
  tf: { nom: 'Terraforme', max: 50_000_000 },       // indice de terraformation
};

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

const joueurs = jeu => db.collection('jeux').doc(jeu).collection('joueurs');

async function top(jeu, n) {
  const snap = await joueurs(jeu).orderBy('score', 'desc').limit(n).get();
  return snap.docs.map(d => { const x = d.data(); return { nom: x.nom, score: x.score, detail: x.detail || null, date: x.date.toDate().toISOString() }; });
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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/scores' && req.method === 'GET') {
      const jeu = url.searchParams.get('jeu');
      if (!JEUX[jeu]) return repondre(res, 400, { erreur: 'jeu inconnu' });
      const n = Math.min(50, Math.max(1, parseInt(url.searchParams.get('n'), 10) || 10));
      res.setHeader('Cache-Control', 'public, max-age=15');
      return repondre(res, 200, { jeu, scores: await top(jeu, n) });
    }
    if (url.pathname === '/scores' && req.method === 'POST') {
      if (!origine || !ORIGINES.test(origine)) return repondre(res, 403, { erreur: 'origine refusée' });
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
      if (tropDEnvois(ip)) return repondre(res, 429, { erreur: 'trop d’envois, réessaie plus tard' });
      const b = await lireCorps(req);
      const jeu = b.jeu, nom = nettoyerNom(b.nom), score = b.score, detail = nettoyerDetail(b.detail);
      if (!JEUX[jeu]) return repondre(res, 400, { erreur: 'jeu inconnu' });
      if (!nom) return repondre(res, 400, { erreur: 'pseudo invalide (2 à 16 caractères)' });
      if (!Number.isInteger(score) || score < 0 || score > JEUX[jeu].max) return repondre(res, 400, { erreur: 'score invalide' });
      return repondre(res, 200, { jeu, nom, ...(await enregistrer(jeu, nom, score, detail)) });
    }
    if (url.pathname === '/') return repondre(res, 200, { ok: true, jeux: Object.keys(JEUX) });
    repondre(res, 404, { erreur: 'introuvable' });
  } catch (e) {
    console.error(e);
    repondre(res, 500, { erreur: 'erreur serveur' });
  }
}).listen(process.env.PORT || 8080);
