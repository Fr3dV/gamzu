/* Manette pour les jeux gamzu.fr — à charger dans chaque jeu, avant le script du jeu :
 *   <script src="https://gamzu.fr/gamzu-pad.js"></script>
 * Le jeu doit continuer à marcher si ce fichier ne charge pas : tester window.GamzuPad.
 *
 *   GamzuPad.init({
 *     touches:  { A: 'KeyE', X: 'KeyC', START: fn, ... }  bouton → code clavier simulé, ou fonction appelée à l’appui
 *     toujours: ['Y']             boutons qui restent actifs quand un menu est ouvert
 *     menu:     () => el | null   menu ouvert à parcourir à la croix (null = en jeu)
 *     retour:   () => {}          bouton B dans un menu
 *     aide:     'RT avancer · …'  rappel des commandes affiché à la première connexion
 *   })
 *   GamzuPad.axes   → { lx, ly, rx, ry, lt, rt } (sticks -1..1 avec zone morte, gâchettes 0..1)
 *   GamzuPad.actif  → true si une manette est branchée et a servi en dernier
 *   GamzuPad.vibrer(ms, force)
 *
 * Boutons (disposition standard, Xbox) : A B X Y LB RB LT RT SELECT START LS RS HAUT BAS GAUCHE DROITE
 * Sur DualSense : A = croix, B = rond, X = carré, Y = triangle.
 * Dans un menu : croix ou stick gauche pour se déplacer, A ou START pour valider, B pour revenir.
 * Un élément marqué data-pad="non" est ignoré par la navigation (ex. bouton qui ouvre un confirm()).
 * Les boutons désactivés restent atteignables (pour lire la carte qui les contient) mais A n’y fait rien.
 * SELECT maintenu ~0,7 s : ouvre/ferme le menu gamzu.fr (gamzu-menu.js, s’il est chargé), prioritaire sur le menu du jeu.
 */
(function () {
  if (window.GamzuPad) return;
  var NOMS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'SELECT', 'START', 'LS', 'RS', 'HAUT', 'BAS', 'GAUCHE', 'DROITE'];
  var ZONE = 0.18;
  var opts = { touches: {}, toujours: [] };
  var prec = {};           // état précédent des boutons
  var tenus = {};          // codes clavier actuellement simulés
  var nav = { dir: null, t: 0, rep: false };
  var focus = null, focusPos = null, dernierMenu = null, aideVue = false, boucle = false, selectT = 0;
  var axes = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 };
  var api = { axes: axes, actif: false, init: init, vibrer: vibrer };
  window.GamzuPad = api;

  var css = document.createElement('style');
  css.textContent =
    '.gp-focus{outline:3px solid #0f2742!important;outline-offset:2px!important;box-shadow:0 0 0 5px #fff,0 0 0 9px #ffb703!important;position:relative;z-index:1}' +
    '#gp-bulle{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;max-width:min(92vw,720px);' +
    'background:rgba(15,25,40,.92);color:#fff;font:600 15px/1.4 system-ui,sans-serif;padding:10px 16px;border-radius:12px;' +
    'text-align:center;pointer-events:none;transition:opacity .4s;opacity:0}#gp-bulle.on{opacity:1}';
  (document.head || document.documentElement).appendChild(css);

  function init(o) {
    for (var k in o) opts[k] = o[k];
    opts.touches = opts.touches || {};
    opts.toujours = opts.toujours || [];
    demarrer();
    return api;
  }

  function demarrer() {
    if (boucle) return;
    boucle = true;
    requestAnimationFrame(tick);
  }

  window.addEventListener('gamepadconnected', function () { demarrer(); bulle('🎮 Manette connectée' + (opts.aide && !aideVue ? '<br>' + opts.aide : ''), opts.aide && !aideVue ? 7000 : 2500); aideVue = true; });
  window.addEventListener('gamepaddisconnected', function () { if (!manette()) { setActif(false); toutRelacher(); bulle('🎮 Manette déconnectée', 2500); } });
  ['mousemove', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, function (e) { if (ev === 'mousemove' && !(e.movementX || e.movementY)) return; setActif(false); }, { passive: true });
  });

  function manette() {
    var l = navigator.getGamepads ? navigator.getGamepads() : [];
    for (var i = 0; i < l.length; i++) if (l[i] && l[i].connected) return l[i];
    return null;
  }

  function setActif(v) {
    if (api.actif === v) return;
    api.actif = v;
    document.documentElement.classList.toggle('gamzu-manette', v);
    if (document.body) document.body.classList.toggle('gamzu-manette', v);
    if (!v) poserFocus(null);
  }

  function zone(x, y) {
    var m = Math.hypot(x, y);
    if (m < ZONE) return [0, 0];
    var s = Math.min(1, (m - ZONE) / (1 - ZONE)) / m;
    return [x * s, y * s];
  }

  function tick(now) {
    requestAnimationFrame(tick);
    var p = manette();
    if (!p) { axes.lx = axes.ly = axes.rx = axes.ry = axes.lt = axes.rt = 0; return; }
    var b = p.buttons, a = p.axes;
    var g = zone(a[0] || 0, a[1] || 0), d = zone(a[2] || 0, a[3] || 0);
    axes.lx = g[0]; axes.ly = g[1]; axes.rx = d[0]; axes.ry = d[1];
    axes.lt = b[6] ? (b[6].value || (b[6].pressed ? 1 : 0)) : 0;
    axes.rt = b[7] ? (b[7].value || (b[7].pressed ? 1 : 0)) : 0;
    if (axes.lt < 0.06) axes.lt = 0;
    if (axes.rt < 0.06) axes.rt = 0;

    var appuis = {}, bouge = g[0] || g[1] || d[0] || d[1] || axes.lt || axes.rt;
    for (var i = 0; i < NOMS.length; i++) {
      var on = !!(b[i] && (b[i].pressed || b[i].value > 0.5));
      if (on !== !!prec[NOMS[i]]) appuis[NOMS[i]] = on;
      prec[NOMS[i]] = on;
      if (on) bouge = true;
    }
    if (bouge) setActif(true);

    // Appui long sur SELECT → menu gamzu.fr
    var gm = window.GamzuMenu;
    if (prec.SELECT) { if (!selectT) selectT = now; else if (selectT > 0 && now - selectT > 700) { selectT = -1; if (gm) { gm.basculer(); vibrer(60, 0.4); } } }
    else selectT = 0;
    var menuGz = gm && gm.element;
    var menu = menuGz || (opts.menu ? opts.menu() : null);
    if (menu !== dernierMenu) { toutRelacher(); dernierMenu = menu; focusPos = null; poserFocus(menu ? premier(menu) : null); }
    else if (menu && focus && !focus.isConnected) poserFocus(proche(menu)); // le menu a été redessiné

    for (var n in appuis) {
      var bas = appuis[n];
      if (menu && (menuGz || opts.toujours.indexOf(n) < 0)) {
        if (!bas) continue;
        if (n === 'A' || n === 'START') { if (!focus || !valide(focus, menu)) poserFocus(premier(menu)); if (focus && !focus.disabled) focus.click(); }
        else if (n === 'B') {
          if (menuGz) gm.fermer();
          else if (opts.retour) opts.retour();
          else { simuler('Escape', true); simuler('Escape', false); }
        }
        continue;
      }
      var t = opts.touches[n];
      if (typeof t === 'function') { if (bas) t(); }
      else if (t) simuler(t, bas);
    }

    if (menu) naviguer(menu, p, g, now);
  }

  /* ---------- Clavier simulé ---------- */
  function cle(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
    if (/^(Digit|Numpad)[0-9]$/.test(code)) return code.slice(-1);
    if (code === 'Space') return ' ';
    return code;
  }
  function simuler(code, bas) {
    if (bas) tenus[code] = true; else if (!tenus[code]) return; else delete tenus[code];
    var ev = new KeyboardEvent(bas ? 'keydown' : 'keyup', { code: code, key: cle(code), bubbles: true, cancelable: true });
    (document.activeElement && document.activeElement !== document.body ? document.activeElement : document).dispatchEvent(ev);
  }
  function toutRelacher() { for (var c in tenus) simuler(c, false); }

  /* ---------- Navigation dans les menus ---------- */
  function candidats(menu) {
    var l = menu.querySelectorAll('button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'), r = [];
    for (var i = 0; i < l.length; i++) if (valide(l[i], menu)) r.push(l[i]);
    return r;
  }
  function valide(el, menu) {
    if (!el || !el.isConnected || !menu.contains(el) || el.getAttribute('data-pad') === 'non') return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    // checkVisibility écarte aussi le contenu d’un <details> fermé, que getBoundingClientRect laisse passer
    if (el.checkVisibility) return el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true });
    var s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  }
  function premier(menu) {
    if (focus && valide(focus, menu)) return focus;
    var c = candidats(menu);
    for (var i = 0; i < c.length; i++) if (c[i].hasAttribute('autofocus') || c[i].getAttribute('data-pad') === 'defaut') return c[i];
    for (i = 0; i < c.length; i++) if (!c[i].disabled) return c[i];
    return c[0] || null;
  }
  function proche(menu) {
    if (!focusPos) return premier(menu);
    var c = candidats(menu), best = null, bs = Infinity;
    for (var i = 0; i < c.length; i++) {
      var r = c[i].getBoundingClientRect(), d = Math.hypot(r.left + r.width / 2 - focusPos.x, r.top + r.height / 2 - focusPos.y);
      if (d < bs) { bs = d; best = c[i]; }
    }
    return best;
  }
  function poserFocus(el) {
    if (focus) focus.classList.remove('gp-focus');
    focus = el;
    if (!el) return;
    el.classList.add('gp-focus');
    var r = el.getBoundingClientRect();
    focusPos = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    try { el.focus({ preventScroll: true }); } catch (e) { }
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function naviguer(menu, p, g, now) {
    var b = p.buttons, dir = null;
    if (b[12] && b[12].pressed || g[1] < -0.5) dir = 'h';
    else if (b[13] && b[13].pressed || g[1] > 0.5) dir = 'b';
    else if (b[14] && b[14].pressed || g[0] < -0.5) dir = 'g';
    else if (b[15] && b[15].pressed || g[0] > 0.5) dir = 'd';
    if (!dir) { nav.dir = null; return; }
    if (dir === nav.dir && now < nav.t) return;
    nav.t = now + (dir === nav.dir ? 130 : 380);
    nav.dir = dir;
    deplacer(menu, dir);
  }
  function deplacer(menu, dir) {
    if (!focus || !valide(focus, menu)) { poserFocus(premier(menu)); return; }
    var r0 = focus.getBoundingClientRect(), x0 = r0.left + r0.width / 2, y0 = r0.top + r0.height / 2;
    var vx = dir === 'g' ? -1 : dir === 'd' ? 1 : 0, vy = dir === 'h' ? -1 : dir === 'b' ? 1 : 0;
    var best = null, bs = Infinity, c = candidats(menu);
    for (var i = 0; i < c.length; i++) {
      if (c[i] === focus) continue;
      var r = c[i].getBoundingClientRect(), dx = r.left + r.width / 2 - x0, dy = r.top + r.height / 2 - y0;
      var av = dx * vx + dy * vy, lat = Math.abs(dx * vy - dy * vx);
      if (av <= 4 || lat > av * 2) continue; // seulement ce qui est à peu près dans la direction demandée
      var s = av + lat * 2.2 + (lat > av ? 1e5 : 0); // d’abord ce qui est dans un cône de 45°
      if (s < bs) { bs = s; best = c[i]; }
    }
    if (best) poserFocus(best);
  }

  /* ---------- Divers ---------- */
  function vibrer(ms, force) {
    var p = api.actif && manette();
    var v = p && p.vibrationActuator;
    if (!v || !v.playEffect) return;
    force = force == null ? 0.6 : force;
    try { v.playEffect('dual-rumble', { duration: ms || 120, strongMagnitude: force, weakMagnitude: Math.min(1, force * 0.8) }); } catch (e) { }
  }
  var bulleT = 0;
  function bulle(html, ms) {
    var el = document.getElementById('gp-bulle');
    if (!el) { el = document.createElement('div'); el.id = 'gp-bulle'; (document.body || document.documentElement).appendChild(el); }
    el.innerHTML = html;
    el.classList.add('on');
    clearTimeout(bulleT);
    bulleT = setTimeout(function () { el.classList.remove('on'); }, ms || 2500);
  }
})();
