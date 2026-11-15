// Which screen an address shows. Everything except the game lives at "/" and is chosen by the
// hash, so the host needs no extra rewrite rules:
//   /            the home page
//   /#explore    the 3D app with its full tools
//   /#casual     the 3D app opened with the panels hidden
//   /#plan       the 3D app with the Compare sites ("Plan") view open
// A landing site can follow the mode, as in /#explore/shackleton.

const APP_MODES = ['explore', 'casual', 'plan'];

export function parseHash(hash = window.location.hash) {
  const [mode, siteId] = hash.replace(/^#\/?/, '').split('/');
  return APP_MODES.includes(mode) ? { mode, siteId: siteId || null } : { mode: 'home', siteId: null };
}

export const hashFor = (mode, siteId) => `#${mode}${siteId ? `/${siteId}` : ''}`;

/** Click handler for links to "/": shows the home page without reloading the site. */
export function goHome(event) {
  // Leave new-tab clicks (Ctrl, middle button and so on) to the browser.
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  window.history.pushState(null, '', window.location.pathname + window.location.search);
  window.dispatchEvent(new PopStateEvent('popstate'));   // pushState is silent; tell Root the address changed
}
