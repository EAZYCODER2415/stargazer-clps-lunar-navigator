import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Root from './Root.jsx'

// The loading screen written into index.html stays up for at least this long after the page
// starts loading, so a fast connection does not flash straight past it. A slow connection
// that has already waited longer is not held back any further.
const MIN_LOADING_MS = 2200
const FADE_MS = 350

function start() {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  )
}

window.setTimeout(() => {
  const loading = document.querySelector('#root > .boot-screen')
  if (!loading) { start(); return }
  loading.classList.add('boot-leaving')
  window.setTimeout(start, FADE_MS)
}, Math.max(0, MIN_LOADING_MS - FADE_MS - performance.now()))
