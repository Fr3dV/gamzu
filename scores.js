/* Scores partagés gamzu.fr — à charger dans chaque jeu :
 *   <script src="https://gamzu.fr/scores.js"></script>
 * Le pseudo est gardé dans un cookie commun à *.gamzu.fr.
 *
 *   Gamzu.nom()                      → pseudo enregistré ou null
 *   Gamzu.setNom(n)                  → enregistre le pseudo
 *   Gamzu.envoyer(jeu, score, pseudo, detail) → Promise {rang, total, meilleur, record}
 *   Gamzu.top(jeu, n, frais)         → Promise [{nom, score, detail, date}] (frais : sans cache)
 *   Gamzu.panneau(el, jeu, score, detail) → affiche dans el : saisie du pseudo, envoi, top 10
 *   (detail : court texte affiché à côté du score, ex. le palier atteint)
 *
 * Mesure d'audience anonyme (pas de cookie, rien d'identifiant : de simples compteurs) :
 *   une visite est comptée automatiquement au chargement de la page.
 *   Gamzu.partie()                   → à appeler au début de chaque partie
 *   Gamzu.fin()                      → à appeler à la fin (envoie la durée ; aussi envoyée si l'onglet se ferme)
 */
(function () {
  var API = 'https://gamzu-scores-240503224375.europe-west1.run.app';
  var COOKIE = 'gamzu_nom';

  function lireCookie() {
    var m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function nom() {
    var n = lireCookie();
    if (!n) try { n = localStorage.getItem(COOKIE); } catch (e) { }
    return n || null;
  }
  function setNom(n) {
    n = String(n || '').trim().slice(0, 16);
    var dom = /(^|\.)gamzu\.fr$/.test(location.hostname) ? '; domain=.gamzu.fr' : '';
    document.cookie = COOKIE + '=' + encodeURIComponent(n) + '; path=/; max-age=63072000; samesite=lax' +
      (location.protocol === 'https:' ? '; secure' : '') + dom;
    try { localStorage.setItem(COOKIE, n); } catch (e) { }
    return n;
  }
  function json(r) {
    return r.json().then(function (b) { if (!r.ok) throw new Error(b.erreur || 'erreur ' + r.status); return b; });
  }
  function envoyer(jeu, score, pseudo, detail) {
    return fetch(API + '/scores', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jeu: jeu, nom: pseudo || nom(), score: Math.round(score), detail: detail || undefined })
    }).then(json);
  }
  function top(jeu, n, frais) {
    return fetch(API + '/scores?jeu=' + encodeURIComponent(jeu) + '&n=' + (n || 10), frais ? { cache: 'no-store' } : {}).then(json)
      .then(function (b) { return b.scores; });
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function fmt(x) { return Number(x).toLocaleString('fr-FR'); }

  // Couleurs dérivées de currentColor : lisible sur fond clair comme sombre.
  var CSS = '.gz-p{font:14px/1.4 system-ui,sans-serif;color:inherit;text-align:left;margin:14px 0;max-width:420px}' +
    '.gz-p h4{margin:0 0 8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.75}' +
    '.gz-f{display:flex;gap:6px;margin-bottom:8px}.gz-f input{flex:1;min-width:0;padding:7px 9px;border-radius:4px;border:1px solid color-mix(in srgb,currentColor 35%,transparent);background:color-mix(in srgb,currentColor 6%,transparent);color:inherit;font:inherit}' +
    '.gz-f button{padding:7px 12px;border-radius:4px;border:0;background:#F5A524;color:#0B1220;font:inherit;font-weight:600;cursor:pointer}' +
    '.gz-m{margin:6px 0;font-size:13px}.gz-m.err{color:#d9432f}' +
    '.gz-t{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}.gz-t td{padding:3px 6px;border-top:1px solid color-mix(in srgb,currentColor 15%,transparent)}' +
    '.gz-t small{opacity:.6;margin-left:6px}.gz-t td:first-child{width:2.2em;opacity:.6}.gz-t td:last-child{text-align:right}.gz-t tr.moi td{background:rgba(245,165,36,.22);font-weight:700}' +
    '.gz-s{margin:6px 0 10px;padding:7px 10px;border-radius:6px;background:rgba(245,165,36,.16);font-size:13px;animation:gz-pop .45s ease-out}' +
    '@keyframes gz-pop{0%{transform:scale(.6);opacity:0}70%{transform:scale(1.05)}100%{transform:scale(1);opacity:1}}' +
    '@media (prefers-reduced-motion:reduce){.gz-s{animation:none}}';
  function styles() {
    if (document.getElementById('gz-css')) return;
    var s = document.createElement('style'); s.id = 'gz-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  // Petite surprise de fin de partie, purement pour rire : une fois sur trois environ, un titre
  // rigolo s'affiche avec le score. Volontairement sans collection, sans rareté, sans rien à
  // débloquer ni à perdre : ce n'est pas une raison de revenir, juste un clin d'œil.
  var SURPRISES = [
    'Titre du jour : Pilote en pyjama', 'Titre du jour : Légende du canapé', 'Titre du jour : Champion·ne des pixels',
    'Titre du jour : As du clavier', 'Titre du jour : Tornade en baskets', 'Titre du jour : Génie de la récré',
    'Un chat imaginaire applaudit des deux pattes', 'Un pingouin a vu ta partie. Il est impressionné.',
    'Ta souris demande une pause goûter', 'Tes réflexes ont été repérés par la NASA (presque)',
    'Bravo ! Ta grand-mère serait fière', 'Même le boss final a pris des notes'
  ];
  var CHANCE_SURPRISE = 0.35;
  function surprise() {
    return Math.random() < CHANCE_SURPRISE ? SURPRISES[Math.floor(Math.random() * SURPRISES.length)] : null;
  }

  function tableau(scores, moi) {
    if (!scores.length) return '<p class="gz-m">Aucun score pour l’instant.</p>';
    return '<table class="gz-t">' + scores.map(function (s, i) {
      var c = moi && s.nom.toLowerCase() === moi.toLowerCase() ? ' class="moi"' : '';
      return '<tr' + c + '><td>' + (i + 1) + '</td><td>' + esc(s.nom) + (s.detail ? '<small>' + esc(s.detail) + '</small>' : '') + '</td><td>' + fmt(s.score) + '</td></tr>';
    }).join('') + '</table>';
  }

  // Panneau de fin de partie : demande le pseudo si besoin, envoie le score, affiche le top 10.
  function panneau(el, jeu, score, detail) {
    styles();
    el.innerHTML = '<div class="gz-p"><h4>Classement</h4><div class="gz-c"></div><div class="gz-l"></div></div>';
    var zone = el.querySelector('.gz-c'), liste = el.querySelector('.gz-l');
    function afficherTop(frais) {
      top(jeu, 10, frais).then(function (s) { liste.innerHTML = tableau(s, nom()); })
        .catch(function () { liste.innerHTML = '<p class="gz-m err">Classement indisponible.</p>'; });
    }
    function soumettre(pseudo) {
      zone.innerHTML = '<p class="gz-m">Envoi du score…</p>';
      envoyer(jeu, score, pseudo, detail).then(function (r) {
        zone.innerHTML = '<p class="gz-m">' + esc(r.nom) + ' : ' + (r.record ? 'nouveau record, ' : 'meilleur score ' + fmt(r.meilleur) + ', ') +
          r.rang + '<sup>e</sup> sur ' + r.total + '</p>';
        var bonus = surprise();
        if (bonus) zone.innerHTML += '<p class="gz-s">🎁 ' + esc(bonus) + '</p>';
        afficherTop(true);
      }).catch(function (e) { formulaire(e.message); });
    }
    function formulaire(erreur) {
      zone.innerHTML = '<form class="gz-f"><input maxlength="16" placeholder="Ton pseudo" required><button>Enregistrer</button></form>' +
        (erreur ? '<p class="gz-m err">' + esc(erreur) + '</p>' : '');
      var f = zone.querySelector('form'), i = f.querySelector('input');
      i.value = nom() || '';
      // Les jeux écoutent le clavier : on évite que la saisie déclenche des commandes.
      i.addEventListener('keydown', function (e) { e.stopPropagation(); });
      f.addEventListener('submit', function (e) { e.preventDefault(); soumettre(setNom(i.value)); });
      setTimeout(function () { i.focus(); }, 50);
    }
    if (score > 0 && nom()) soumettre(nom());
    else if (score > 0) { formulaire(); afficherTop(); }
    else afficherTop();
  }

  // --- Mesure d'audience ---------------------------------------------------
  // Site d'après le sous-domaine : fz.gamzu.fr → fz ; gamzu.fr (ou local) → portail.
  var SITE = (function () {
    var h = location.hostname.split('.');
    return h.length > 2 && h[h.length - 2] === 'gamzu' ? h[0] : 'portail';
  })();
  var debutPartie = 0;
  function evt(type, extra) {
    var corps = JSON.stringify(Object.assign({ type: type, jeu: SITE }, extra || {}));
    try {
      // sendBeacon survit à la fermeture de l'onglet ; text/plain évite la requête préalable CORS.
      if (navigator.sendBeacon && navigator.sendBeacon(API + '/evt', new Blob([corps], { type: 'text/plain' }))) return;
    } catch (e) { }
    fetch(API + '/evt', { method: 'POST', body: corps, keepalive: true }).catch(function () { });
  }
  function partie() { if (debutPartie) fin(); debutPartie = Date.now(); evt('partie'); }
  function fin() {
    if (!debutPartie) return;
    var duree = Math.round((Date.now() - debutPartie) / 1000);
    debutPartie = 0;
    if (duree > 0) evt('fin', { duree: duree });
  }
  addEventListener('pagehide', fin);
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !/\/stats/.test(location.pathname)) evt('visite');

  window.Gamzu = { API: API, nom: nom, setNom: setNom, envoyer: envoyer, top: top, panneau: panneau, tableau: tableau, partie: partie, fin: fin };
})();
