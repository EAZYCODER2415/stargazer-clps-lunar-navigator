import { lazy, Suspense, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import './home.css';

// The globe brings three.js and the ephemeris with it, so it loads after the page has painted.
const MoonStage = lazy(() => import('./MoonStage.jsx'));

const API_DOCS = `${(import.meta.env.VITE_STARGAZER_API || 'http://127.0.0.1:8000').replace(/\/+$/, '')}/api/v1/docs`;

// The start menu. Each way in is one word; the line under the menu says what the chosen one does.
const WAYS_IN = [
  { word: 'Game', title: 'Fly Mission 001.', text: 'Plan and fly a robotic lander to the Moon.', href: '/game' },
  { word: 'Plan', title: 'Compare landing sites and dates.', text: 'Sunlight and radio contact for each.', href: '/#plan' },
  { word: 'Explore', title: 'Stand on the Moon and look around.', text: 'A clear 3D view from the surface.', href: '/#casual' }
];

function HomePage() {
  // The highlighted menu entry, as on a game's title screen: it follows the pointer and the keyboard.
  const [chosen, setChosen] = useState(0);
  const entries = useRef([]);
  const onMenuKey = (event) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    entries.current[(chosen + step + WAYS_IN.length) % WAYS_IN.length]?.focus();
  };
  const onPoint = (index) => {
    // If the keyboard is already in the menu, the pointer takes it along, so Enter opens the highlighted entry.
    if (entries.current.includes(document.activeElement)) entries.current[index].focus();
    setChosen(index);
  };

  return (
    <div className="home-page">
      <main className="home-shell">
        <div className="home-top">
          <img src="/favicon.svg" alt="" />
          <h1>Stargazer</h1>
          <span>CLPS Lunar Mission Navigator</span>
        </div>

        <p className="home-lede">
          See when the Sun and Earth are in view from three candidate landing sites near the Moon’s south pole.
        </p>

        <nav className="home-menu" aria-label="Start" onKeyDown={onMenuKey}>
          {WAYS_IN.map((way, index) => (
            <a
              className={`home-menu-item${chosen === index ? ' is-chosen' : ''}`}
              href={way.href}
              key={way.word}
              ref={(element) => { entries.current[index] = element; }}
              onMouseEnter={() => onPoint(index)}
              onFocus={() => setChosen(index)}
            >
              <span className="home-menu-index" aria-hidden="true">0{index + 1}</span>
              <span className="home-menu-word">{way.word}</span>
              <ArrowRight className="home-menu-arrow" aria-hidden="true" />
              <span className="home-menu-hint"><b>{way.title}</b> {way.text}</span>
            </a>
          ))}
        </nav>

        <Suspense fallback={<div className="moon-stage"><div className="moon-globe is-loading">Loading the Moon…</div></div>}>
          <MoonStage />
        </Suspense>

        <footer className="home-footer">
          <span>Data: NASA/JPL Horizons, NASA LRO LOLA</span>
          <span>Sunlight from Horizons data. Surface detail is illustrative.</span>
          <span>Education prototype, not flight software.</span>
          <a href={API_DOCS} target="_blank" rel="noreferrer">
            Developers / API
            <ArrowUpRight aria-hidden="true" />
          </a>
        </footer>
      </main>
    </div>
  );
}

export default HomePage;
