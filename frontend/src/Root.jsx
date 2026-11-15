import { lazy, Suspense, useSyncExternalStore } from 'react';
import HomePage from './home/HomePage.jsx';
import LoadingScreen from './LoadingScreen.jsx';
import { parseHash } from './routes.js';

// The home page is small, so it ships with the first download. The 3D app and the game are
// each fetched only when their address is opened.
const App = lazy(() => import('./App.jsx'));
const GamePage = lazy(() => import('./game/GamePage.jsx'));
const isGame = window.location.pathname.replace(/\/$/, '') === '/game';

// The page follows the address without a reload: links change the hash, and Back / Forward
// (and the app's Home link) raise popstate.
function watchAddress(onChange) {
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
  };
}
const isHomeAddress = () => parseHash().mode === 'home';

function Root() {
  const atHome = useSyncExternalStore(watchAddress, isHomeAddress);
  if (!isGame && atHome) return <HomePage />;
  const Page = isGame ? GamePage : App;
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Page />
    </Suspense>
  );
}

export default Root;
