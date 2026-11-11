/* Menu commun des jeux gamzu.fr : petit bouton « gamzu » qui ouvre un menu pour revenir au portail
 * ou passer à un autre jeu. À charger dans chaque jeu (n'importe où, de préférence en fin de <body>) :
 *   <script src="https://gamzu.fr/gamzu-menu.js" data-position="haut-gauche"></script>
 * data-position : haut-gauche (défaut) · haut-centre · haut-droite · bas-gauche · bas-centre · bas-droite
 * data-jeu : code du jeu courant (ex. "mz"), à préciser seulement si le jeu n'est pas servi depuis <code>.gamzu.fr.
 * Le bouton se cache pendant le verrouillage de la souris (jeux à la première personne).
 * window.GamzuMenu.ouvrir() / .fermer() / .basculer() pour l'ouvrir depuis le jeu (ex. bouton manette).
 */
(function () {
  if (window.GamzuMenu) return;
  var PORTAIL = 'https://gamzu.fr/';
  var JEUX = [
    ['fz', 'Front Zéro'],
    ['gxf', 'Guerre X Force'],
    ['tf', 'Terraforme'],
    ['cnt', 'Chasse-Neige Tycoon'],
    ['lgc', 'La Grande Chasse'],
    // 3e élément facultatif = adresse complète, pour un jeu qui n'est pas (encore) sur <code>.gamzu.fr.
    // Mission Zéro : adresse provisoire en attendant mz.gamzu.fr.
    ['mz', 'Mission Zéro', 'https://mission-zero-386737191383.europe-west1.run.app/']
  ];
  var script = document.currentScript;
  var pos = (script && script.getAttribute('data-position')) || 'haut-gauche';
  var ici = (script && script.getAttribute('data-jeu')) || location.hostname.split('.')[0];

  var css =
    '#gzm{position:fixed;z-index:2147483646;font:600 14px/1.3 system-ui,sans-serif;color:#fff}' +
    '#gzm.haut-gauche{top:10px;left:10px}#gzm.haut-droite{top:10px;right:10px;text-align:right}' +
    '#gzm.haut-centre{top:10px;left:50%;transform:translateX(-50%)}#gzm.bas-centre{bottom:10px;left:50%;transform:translateX(-50%)}' +
    '#gzm.haut-centre nav,#gzm.bas-centre nav{position:absolute;left:50%;transform:translateX(-50%)}#gzm.haut-centre nav{top:100%}' +
    '#gzm.bas-gauche{bottom:10px;left:10px}#gzm.bas-droite{bottom:10px;right:10px;text-align:right}' +
    '#gzm.cache{display:none}' +
    '#gzm>button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;cursor:pointer;padding:6px 10px;border-radius:8px;' +
    'background:rgba(11,18,32,.55);color:#fff;font:700 13px/1 system-ui,sans-serif;letter-spacing:.04em;opacity:.55;transition:opacity .2s,background .2s}' +
    '#gzm>button:hover,#gzm>button:focus-visible,#gzm.ouvert>button{opacity:1;background:rgba(11,18,32,.9)}' +
    '#gzm>button:focus-visible{outline:2px solid #F5A524;outline-offset:2px}' +
    '#gzm>button b{color:#F5A524}' +
    '#gzm nav{display:none;margin-top:6px;min-width:220px;padding:6px;border-radius:10px;background:rgba(11,18,32,.95);box-shadow:0 8px 28px rgba(0,0,0,.45);text-align:left}' +
    '#gzm.bas-gauche nav,#gzm.bas-centre nav,#gzm.bas-droite nav{position:absolute;bottom:100%;margin:0 0 6px}#gzm.haut-droite nav,#gzm.bas-droite nav{right:0}' +
    '#gzm.ouvert nav{display:block}' +
    '#gzm nav a{display:block;padding:9px 12px;border-radius:6px;color:#fff;text-decoration:none}' +
    '#gzm nav a:hover,#gzm nav a:focus-visible{background:rgba(245,165,36,.2);outline:none}' +
    '#gzm nav a.portail{background:#F5A524;color:#0B1220;font-weight:800}#gzm nav a.portail:hover,#gzm nav a.portail:focus-visible{background:#ffbf47}' +
    '#gzm nav small{display:block;padding:8px 12px 4px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.55}';

  var racine, ouvert = false;

  function monter() {
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);

    racine = document.createElement('div');
    racine.id = 'gzm';
    racine.className = pos;
    var liens = '<a class="portail" href="' + PORTAIL + '">← Tous les jeux · gamzu.fr</a><small>Autres jeux</small>';
    JEUX.forEach(function (j) {
      if (j[0] !== ici) liens += '<a href="' + (j[2] || 'https://' + j[0] + '.gamzu.fr/') + '">' + j[1] + '</a>';
    });
    racine.innerHTML = '<button type="button" aria-haspopup="true" aria-expanded="false" title="Menu gamzu.fr">☰ <b>gamzu</b></button>' +
      '<nav aria-label="Jeux gamzu.fr">' + liens + '</nav>';
    document.body.appendChild(racine);

    var bouton = racine.firstChild;
    bouton.addEventListener('click', function (e) { e.stopPropagation(); basculer(); });
    // Les clics dans le menu ne doivent pas atteindre le jeu (tir, verrouillage de la souris…).
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'click', 'contextmenu'].forEach(function (ev) {
      racine.addEventListener(ev, function (e) { e.stopPropagation(); });
    });
    document.addEventListener('click', function (e) { if (ouvert && !racine.contains(e.target)) fermer(); }, true);
    document.addEventListener('keydown', function (e) {
      if (ouvert && e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); fermer(); bouton.focus(); }
    }, true);
    document.addEventListener('pointerlockchange', majVisibilite);
    majVisibilite();
  }

  function majVisibilite() {
    var verrou = !!document.pointerLockElement;
    racine.classList.toggle('cache', verrou);
    if (verrou) fermer();
  }

  function ouvrir() {
    if (!racine) return;
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    ouvert = true;
    racine.classList.remove('cache');
    racine.classList.add('ouvert');
    racine.firstChild.setAttribute('aria-expanded', 'true');
    var p = racine.querySelector('a.portail');
    try { p.focus({ preventScroll: true }); } catch (e) { }
  }
  function fermer() {
    if (!racine || !ouvert) return;
    ouvert = false;
    racine.classList.remove('ouvert');
    racine.firstChild.setAttribute('aria-expanded', 'false');
  }
  function basculer() { ouvert ? fermer() : ouvrir(); }

  window.GamzuMenu = {
    ouvrir: ouvrir, fermer: fermer, basculer: basculer,
    get ouvert() { return ouvert; },
    get element() { return ouvert ? racine.querySelector('nav') : null; }
  };

  if (document.body) monter();
  else document.addEventListener('DOMContentLoaded', monter);
})();
