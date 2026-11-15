// Shown while a part of the site (the 3D app or the game) is being fetched. The same screen
// is written into index.html so it also covers the very first load; its styles live there.
function LoadingScreen() {
  return (
    <div className="boot-screen" role="status" aria-label="Stargazer is loading">
      <div className="boot-core">
        <img src="/favicon.svg" alt="" />
        <p className="boot-name">Stargazer</p>
        <p className="boot-sub">CLPS Lunar Mission Navigator</p>
        <div className="boot-bar"><i /></div>
        <div className="boot-status"><span>Preparing mission systems</span><span>Loading</span></div>
      </div>
      <p className="boot-note">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M8 20h8M12 16v4" /></svg>
        Best experienced on a computer
      </p>
    </div>
  );
}

export default LoadingScreen;
