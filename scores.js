/* Scores partagés gamzu.fr — à charger dans chaque jeu :
 *   <script src="https://gamzu.fr/scores.js"></script>
 * Le pseudo est gardé dans un cookie commun à *.gamzu.fr.
 *
 *   Gamzu.nom()                      → pseudo enregistré ou null
 *   Gamzu.setNom(n)                  → enregistre le pseudo
 *   Gamzu.envoyer(jeu, score)        → Promise {rang, total, meilleur, record}
 *   Gamzu.top(jeu, n)                → Promise [{nom, score, date}]
 *   Gamzu.panneau(el, jeu, score)    → affiche dans el : saisie du pseudo, envoi, top 10
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
  function envoyer(jeu, score, pseudo) {
    return fetch(API + '/scores', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jeu: jeu, nom: pseudo || nom(), score: Math.round(score) })
    }).then(json);
  }
  function top(jeu, n) {
    return fetch(API + '/scores?jeu=' + encodeURIComponent(jeu) + '&n=' + (n || 10)).then(json)
      .then(function (b) { return b.scores; });
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function fmt(x) { return Number(x).toLocaleString('fr-FR'); }

  var CSS = '.gz-p{font:14px/1.4 system-ui,sans-serif;color:inherit;text-align:left;margin:14px 0;max-width:420px}' +
    '.gz-p h4{margin:0 0 8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.75}' +
    '.gz-f{display:flex;gap:6px;margin-bottom:8px}.gz-f input{flex:1;min-width:0;padding:7px 9px;border-radius:4px;border:1px solid rgba(255,255,255,.3);background:rgba(0,0,0,.35);color:inherit;font:inherit}' +
    '.gz-f button{padding:7px 12px;border-radius:4px;border:0;background:#F5A524;color:#0B1220;font:inherit;font-weight:600;cursor:pointer}' +
    '.gz-m{margin:6px 0;font-size:13px}.gz-m.err{color:#ff8a7a}' +
    '.gz-t{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}.gz-t td{padding:3px 6px;border-top:1px solid rgba(255,255,255,.1)}' +
    '.gz-t td:first-child{width:2.2em;opacity:.6}.gz-t td:last-child{text-align:right}.gz-t tr.moi td{color:#F5A524;font-weight:600}';
  function styles() {
    if (document.getElementById('gz-css')) return;
    var s = document.createElement('style'); s.id = 'gz-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  function tableau(scores, moi) {
    if (!scores.length) return '<p class="gz-m">Aucun score pour l’instant.</p>';
    return '<table class="gz-t">' + scores.map(function (s, i) {
      var c = moi && s.nom.toLowerCase() === moi.toLowerCase() ? ' class="moi"' : '';
      return '<tr' + c + '><td>' + (i + 1) + '</td><td>' + esc(s.nom) + '</td><td>' + fmt(s.score) + '</td></tr>';
    }).join('') + '</table>';
  }

  // Panneau de fin de partie : demande le pseudo si besoin, envoie le score, affiche le top 10.
  function panneau(el, jeu, score) {
    styles();
    el.innerHTML = '<div class="gz-p"><h4>Classement</h4><div class="gz-c"></div><div class="gz-l"></div></div>';
    var zone = el.querySelector('.gz-c'), liste = el.querySelector('.gz-l');
    function afficherTop() {
      top(jeu, 10).then(function (s) { liste.innerHTML = tableau(s, nom()); })
        .catch(function () { liste.innerHTML = '<p class="gz-m err">Classement indisponible.</p>'; });
    }
    function soumettre(pseudo) {
      zone.innerHTML = '<p class="gz-m">Envoi du score…</p>';
      envoyer(jeu, score, pseudo).then(function (r) {
        zone.innerHTML = '<p class="gz-m">' + esc(r.nom) + ' : ' + (r.record ? 'nouveau record, ' : 'meilleur score ' + fmt(r.meilleur) + ', ') +
          r.rang + '<sup>e</sup> sur ' + r.total + '</p>';
        afficherTop();
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

  window.Gamzu = { API: API, nom: nom, setNom: setNom, envoyer: envoyer, top: top, panneau: panneau, tableau: tableau };
})();
