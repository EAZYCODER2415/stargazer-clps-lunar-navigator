import { useEffect, useRef } from 'react';

// Developer debug mode. Hidden behind the Konami code followed by Enter; there is no
// visible button. It is on in development builds, and in a production build only when
// the build sets VITE_GAME_DEBUG=1. Leave that variable unset for the public release.
export const DEBUG_ENABLED = import.meta.env.DEV || import.meta.env.VITE_GAME_DEBUG === '1';

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a', 'Enter'];

function isTyping(target) {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

// Calls onUnlock when the full sequence is typed. Any wrong key starts the sequence again.
export function useKonamiCode(onUnlock, enabled = DEBUG_ENABLED) {
  const progress = useRef(0);
  const callback = useRef(onUnlock);
  useEffect(() => { callback.current = onUnlock; }, [onUnlock]);
  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (event) => {
      if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey) { progress.current = 0; return; }
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === KONAMI[progress.current]) progress.current += 1;
      else if (key === 'ArrowUp' && progress.current === 2) progress.current = 2;
      else progress.current = key === KONAMI[0] ? 1 : 0;
      // Once the code is clearly under way, keep its keys from scrolling the page or pressing a focused button.
      if (progress.current >= 3) event.preventDefault();
      if (progress.current === KONAMI.length) { progress.current = 0; callback.current(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
