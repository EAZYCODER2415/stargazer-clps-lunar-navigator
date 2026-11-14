import { lazy, Suspense } from 'react';

const App = lazy(() => import('./App.jsx'));
const GamePage = lazy(() => import('./game/GamePage.jsx'));
const Page = window.location.pathname.replace(/\/$/, '') === '/game' ? GamePage : App;

function Root() {
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}

export default Root;
