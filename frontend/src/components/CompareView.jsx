import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, X } from 'lucide-react';
import { Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  LUNAR_DAYS,
  buildInsights,
  compareSnapshots,
  formatCost,
  formatDate,
  formatDateTime,
  formatDay,
  loadCompare
} from '../utils/compareData';
import landingSites from '../data/landingSites.json';
import '../styles/compareView.css';

const BODIES = [
  { key: 'sun', label: 'Sun' },
  { key: 'earth', label: 'Earth' },
  { key: 'both', label: 'Both' }
];
// What each entry in meta.sources is used for, and which quality flag marks it as unverified.
const SOURCE_ROLES = {
  jpl_horizons: { role: 'Sun and Earth positions' },
  lola_ldem_80s_80m: { role: 'Terrain skyline' },
  stargazer_cost_model: { role: 'Cost model' },
  clps_public_awards: { role: 'Cost anchors', flag: 'COST_ANCHORS_UNVERIFIED' }
};

const UNVERIFIED_WORDING = {
  COST_ANCHORS_UNVERIFIED: 'The three NASA CLPS award values used as cost anchors do not have a source link recorded yet.',
  COORDINATES_UNVERIFIED: 'Site coordinates do not have a citation recorded yet.'
};


/** Ids of the sites with the best value for one stat. Empty when every site ties or none has a value. */
function bestSites(sites, read, pick) {
  const values = sites.map((site) => ({ id: site.site_id, value: read(site) })).filter((entry) => entry.value != null);
  if (values.length < 2) return new Set();
  const best = pick(...values.map((entry) => entry.value));
  const winners = values.filter((entry) => entry.value === best);
  return new Set(winners.length === values.length ? [] : winners.map((entry) => entry.id));
}

const Stat = ({ label, value, detail, isBest, bestLabel }) => (
  <div className={`cv-stat${isBest ? ' is-best' : ''}`}>
    <span className="cv-stat-label">{label}</span>
    <strong>{value}</strong>
    {isBest && <em className="cv-best">{bestLabel}</em>}
    {detail && <small>{detail}</small>}
  </div>
);

/** One bar of the cost chart: the P10 to P90 range, with a tick and a label at the median. */
const RangeBar = ({ x, y, width, height, payload }) => {
  const span = payload.p90 - payload.p10;
  const medianX = x + (span > 0 ? ((payload.p50 - payload.p10) / span) * width : width / 2);
  const barHeight = Math.min(height, 14);
  const top = y + (height - barHeight) / 2;
  return (
    <g>
      <rect x={x} y={top} width={Math.max(width, 2)} height={barHeight} rx={4} className="cv-range-bar" />
      <line x1={medianX} x2={medianX} y1={top - 5} y2={top + barHeight + 5} className="cv-range-median" />
      <text x={medianX} y={top - 9} textAnchor="middle" className="cv-range-label">
        {formatCost(payload.p50)} median
      </text>
    </g>
  );
};

const CostTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="cv-tooltip">
      <strong>{row.name}</strong>
      <span>P10 {formatCost(row.p10)}</span>
      <span>Median {formatCost(row.p50)}</span>
      <span>P90 {formatCost(row.p90)}</span>
      <small>per usable hour, modelled</small>
    </div>
  );
};

const CompareView = ({ time, windowStart, isPlaying, onTogglePlay, onTimeChange, onClose }) => {
  const [lunarDay, setLunarDay] = useState(1);
  const [loaded, setLoaded] = useState(null);
  // Sites the user has unticked. Everything else is compared, so a site new to the API shows up ticked.
  const [hiddenSites, setHiddenSites] = useState(() => new Set());
  const [headerHeight, setHeaderHeight] = useState(52);

  useEffect(() => {
    let cancelled = false;
    loadCompare(lunarDay).then((result) => { if (!cancelled) setLoaded(result); });
    return () => { cancelled = true; };
  }, [lunarDay]);

  // Until the chosen lunar day has answered (API or saved copy), show its saved copy.
  const { payload, source } = loaded?.day === lunarDay
    ? loaded
    : { payload: compareSnapshots[lunarDay], source: 'loading' };

  // The view starts directly under the header, whatever height the header has at this width.
  useEffect(() => {
    const header = document.querySelector('.mission-header');
    if (!header) return undefined;
    const measure = () => setHeaderHeight(Math.ceil(header.getBoundingClientRect().bottom));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Same order as the site menu in the header; sites the app does not list go last.
  const allSites = useMemo(() => {
    const order = landingSites.map((site) => site.id);
    const rank = (id) => (order.includes(id) ? order.indexOf(id) : order.length);
    return [...payload.sites].sort((a, b) => rank(a.site_id) - rank(b.site_id));
  }, [payload]);

  // The sites being compared. Best tags, the takeaways and the cost chart all use only these.
  const sites = useMemo(() => {
    const ticked = allSites.filter((site) => !hiddenSites.has(site.site_id));
    return ticked.length > 0 ? ticked : allSites.slice(0, 1);
  }, [allSites, hiddenSites]);
  const shownIds = new Set(sites.map((site) => site.site_id));
  const toggleSite = (id) => {
    if (shownIds.has(id) && shownIds.size === 1) return;   // at least one site stays ticked
    const nextShown = new Set(shownIds);
    if (nextShown.has(id)) nextShown.delete(id); else nextShown.add(id);
    setHiddenSites(new Set(allSites.map((site) => site.site_id).filter((other) => !nextShown.has(other))));
  };

  const insights = useMemo(() => buildInsights(sites), [sites]);

  const best = useMemo(() => ({
    sun: bestSites(sites, (site) => site.bodies?.sun?.visible_hours, Math.max),
    earth: bestSites(sites, (site) => site.bodies?.earth?.visible_hours, Math.max),
    overlap: bestSites(sites, (site) => site.best_overlap?.duration_h, Math.max),
    cost: bestSites(sites, (site) => site.cost?.metrics?.burn_musd_per_usable_h?.p50, Math.min),
    usable: bestSites(sites, (site) => site.cost?.metrics?.usable_hours?.p50, Math.max)
  }), [sites]);

  const chartRows = sites
    .filter((site) => site.cost?.metrics?.burn_musd_per_usable_h?.p50 != null)
    .map((site) => {
      const burn = site.cost.metrics.burn_musd_per_usable_h;
      return { name: site.name, p10: burn.p10, p50: burn.p50, p90: burn.p90, range: [burn.p10, burn.p90] };
    });
  // Round the axis up to the next $0.2M so the ticks are even.
  const chartMax = Math.ceil((Math.max(0.1, ...chartRows.map((row) => row.p90)) + 0.02) * 5) / 5;

  const meta = payload.meta || {};
  const flags = meta.quality_flags || [];
  // One line per kind of "unverified" flag, in plain words (the API's own messages are notes for developers).
  const unverified = [...new Set(flags.map((flag) => flag.code).filter((code) => code.includes('UNVERIFIED')))];
  const period = sites[0].period;
  // The app's own timeline covers one lunar day. The time marker and click-to-jump only make sense on that one.
  const onTimeline = new Date(period.start_utc).getTime() === windowStart.getTime();
  const sourceLabel = {
    live: 'Live from the Stargazer API',
    snapshot: 'Saved copy of the Stargazer API',
    loading: 'Checking the Stargazer API…'
  }[source];

  return (
    <section className="compare-view" style={{ top: headerHeight }} aria-label="Compare sites">
      <div className="cv-inner">
        <div className="cv-head">
          <div>
            <span className="panel-kicker">MISSION PLANNING</span>
            <h2>Compare sites</h2>
            <p>
              One {(period.hours / 24).toFixed(2)}-day lunar day, {formatDateTime(period.start_utc)} to {formatDateTime(period.end_utc)}, {payload.horizon_model === 'lola_mask' ? 'LOLA terrain skyline' : payload.horizon_model}.
              Geometric visibility only.
            </p>
          </div>
          <div className="cv-head-actions">
            <span className={`cv-source cv-source-${source}`} role="status">
              <i aria-hidden="true" />
              {sourceLabel}
              {source !== 'loading' && meta.dataset_build_id && <b>build {meta.dataset_build_id}</b>}
            </span>
            <div className="cv-clock">
              <button type="button" onClick={onTogglePlay} aria-label={isPlaying ? 'Pause time' : 'Play time'}>
                {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              </button>
              <span>{formatDateTime(time)}</span>
            </div>
            <button type="button" className="cv-close" onClick={onClose} aria-label="Close comparison">
              <X aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="cv-controls">
          <div className="cv-control" role="radiogroup" aria-label="Lunar day">
            <span className="cv-control-label">Lunar day</span>
            <div className="cv-days">
              {LUNAR_DAYS.map((option) => {
                // Dates come from the payload on screen for the chosen day, and from the saved payloads for the others.
                const dates = option.day === lunarDay ? period : option.period;
                return (
                  <button
                    key={option.day}
                    type="button"
                    role="radio"
                    aria-checked={option.day === lunarDay}
                    className={option.day === lunarDay ? 'is-active' : ''}
                    onClick={() => setLunarDay(option.day)}
                  >
                    <b>Lunar day {option.day}</b>
                    <span>{formatDate(dates.start_utc)} to {formatDate(dates.end_utc)}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <fieldset className="cv-control cv-site-picker">
            <legend className="cv-control-label">Sites to compare</legend>
            <div className="cv-site-options">
              {allSites.map((site) => {
                const checked = shownIds.has(site.site_id);
                const isLast = checked && shownIds.size === 1;
                return (
                  <label
                    key={site.site_id}
                    className={`${checked ? 'is-checked' : ''}${isLast ? ' is-locked' : ''}`}
                    title={isLast ? 'At least one site stays selected' : undefined}
                  >
                    <input type="checkbox" checked={checked} disabled={isLast} onChange={() => toggleSite(site.site_id)} />
                    {site.name}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>

        {!onTimeline && (
          <p className="cv-note">
            The 3D view's timeline only covers lunar day 1, so the time marker and click-to-jump are off for this period.
          </p>
        )}

        {insights.length > 0 && (
          <div className="cv-panel cv-insights" aria-live="polite">
            <h3>{sites.length === 1 ? `Takeaways for ${sites[0].name}` : `Takeaways for these ${sites.length} sites`}</h3>
            <ul>
              {insights.map((insight) => (
                <li key={insight.key}>
                  <b>{insight.title}</b>
                  <span>
                    {insight.text}
                    {insight.warning && <em className="cv-insight-warning"> Warning: {insight.warning}</em>}
                  </span>
                </li>
              ))}
            </ul>
            <small>
              Worked out from the numbers below for the selected sites. Cost takeaways come from each site's own cost run,
              so they do not change with the lunar day.
            </small>
          </div>
        )}

        <div className={`cv-cards cv-cards-${Math.min(sites.length, 3)}`}>
          {sites.map((site) => {
            const start = new Date(site.period.start_utc).getTime();
            const span = new Date(site.period.end_utc).getTime() - start;
            const fraction = (ms) => Math.max(0, Math.min(1, (ms - start) / span));
            const nowPercent = fraction(time.getTime()) * 100;
            const seek = (event) => {
              const box = event.currentTarget.getBoundingClientRect();
              const clicked = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
              onTimeChange(new Date(start + clicked * span));
            };
            const ticks = [];
            for (let day = 0; day * 86400000 < span; day += 7) ticks.push(day);
            const burn = site.cost?.metrics?.burn_musd_per_usable_h;
            const usable = site.cost?.metrics?.usable_hours;
            const pZero = site.cost?.p_zero_usable_hours;

            return (
              <article key={site.site_id} className="cv-card">
                <div className="cv-card-head">
                  <h3>{site.name}</h3>
                  <span>
                    {Math.abs(site.latitude_deg).toFixed(2)}° {site.latitude_deg < 0 ? 'S' : 'N'} · {site.longitude_deg_east.toFixed(2)}° E
                  </span>
                </div>

                <div className="cv-tracks">
                  {BODIES.map((body) => (
                    <div className="cv-track-row" key={body.key}>
                      <span>{body.label}</span>
                      <div
                        className={`cv-track${onTimeline ? '' : ' is-static'}`}
                        onClick={onTimeline ? seek : undefined}
                        title={onTimeline ? `${body.label} visible: click to set the time` : `${body.label} visible`}
                      >
                        {(site.windows?.[body.key] || []).map((window) => {
                          const from = window.overlap_start_utc || window.start_utc;
                          const to = window.overlap_end_utc || window.end_utc;
                          const left = fraction(new Date(from).getTime()) * 100;
                          const right = fraction(new Date(to).getTime()) * 100;
                          return (
                            <i
                              key={from}
                              className={`cv-window cv-window-${body.key}`}
                              style={{ left: `${left}%`, width: `${right - left}%` }}
                              title={`${body.label} visible ${formatDateTime(from)} to ${formatDateTime(to)}`}
                            />
                          );
                        })}
                        {onTimeline && <b className="cv-now" style={{ left: `${nowPercent}%` }} />}
                      </div>
                    </div>
                  ))}
                  <div className="cv-track-row cv-axis">
                    <span />
                    <div>
                      {ticks.map((day) => (
                        <small
                          key={day}
                          className={day * 86400000 > span * 0.9 ? 'is-end' : ''}
                          style={{ left: `${fraction(start + day * 86400000) * 100}%` }}
                        >
                          {formatDay(new Date(start + day * 86400000))}
                        </small>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="cv-stats">
                  <Stat
                    label="Sun visible"
                    value={`${site.bodies.sun.visible_hours.toFixed(0)} h`}
                    isBest={best.sun.has(site.site_id)}
                    bestLabel="Most"
                  />
                  <Stat
                    label="Earth visible"
                    value={`${site.bodies.earth.visible_hours.toFixed(0)} h`}
                    isBest={best.earth.has(site.site_id)}
                    bestLabel="Most"
                  />
                  <Stat
                    label="Best overlap"
                    value={site.best_overlap ? `${site.best_overlap.duration_h.toFixed(1)} h` : 'None'}
                    detail={site.best_overlap ? `starts ${formatDateTime(site.best_overlap.start_utc)}` : 'Sun and Earth are never up together'}
                    isBest={best.overlap.has(site.site_id)}
                    bestLabel="Longest"
                  />
                </div>

                <div className="cv-cost">
                  <span className="cv-cost-title">Modelled cost per usable hour</span>
                  {site.cost && burn ? (
                    <>
                      <div className="cv-cost-row">
                        <div><span>P10</span><strong>{formatCost(burn.p10)}</strong></div>
                        <div className={best.cost.has(site.site_id) ? 'is-best' : ''}>
                          <span>Median</span>
                          <strong>{formatCost(burn.p50)}</strong>
                          {best.cost.has(site.site_id) && <em className="cv-best">Lowest</em>}
                        </div>
                        <div><span>P90</span><strong>{formatCost(burn.p90)}</strong></div>
                        <div className={best.usable.has(site.site_id) ? 'is-best' : ''}>
                          <span>Median usable</span>
                          <strong>{usable?.p50 != null ? `${usable.p50.toFixed(0)} h` : 'n/a'}</strong>
                          {best.usable.has(site.site_id) && <em className="cv-best">Most</em>}
                        </div>
                      </div>
                      {pZero > 0 && (
                        <p className="cv-zero">
                          {(pZero * 100).toFixed(1)}% of trials had zero usable hours and are left out of these percentiles.
                        </p>
                      )}
                      <small>
                        Cost run: lands {formatDateTime(site.cost.landing_time_utc)}, {site.cost.mission_days}-day mission.
                        The same for every lunar day.
                      </small>
                    </>
                  ) : (
                    <small>{site.cost_unavailable_reason || 'No cost run for this site.'}</small>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        {chartRows.length > 0 && (
          <div className="cv-panel">
            <h3>Modelled cost per usable hour: median, with the P10 to P90 range</h3>
            <p>$M per usable hour. Each bar runs from P10 to P90; the tick is the median. Lower is cheaper.</p>
            <div className="cv-chart" style={{ height: `${4 + chartRows.length * 2.5}rem` }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartRows} layout="vertical" margin={{ top: 18, right: 24, bottom: 4, left: 8 }}>
                  <CartesianGrid horizontal={false} stroke="rgba(148, 163, 184, 0.16)" />
                  <XAxis
                    type="number"
                    domain={[0, chartMax]}
                    tickFormatter={(value) => `$${value.toFixed(1)}M`}
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    stroke="rgba(148, 163, 184, 0.35)"
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={230}
                    tick={{ fill: '#cbd5e1', fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<CostTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }} />
                  <Bar dataKey="range" shape={<RangeBar />} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="cv-smallprint">
          {payload.cost_caveat && <p><b>Cost caveat.</b> {payload.cost_caveat}</p>}
          {payload.usable_hour_definition && <p><b>Usable hour.</b> {payload.usable_hour_definition}</p>}
        </div>

        <div className="cv-panel cv-sources">
          <h3>Data sources</h3>
          <ul>
            {(meta.sources || []).map((entry) => {
              const known = SOURCE_ROLES[entry.source_id] || { role: 'Source' };
              const flagged = known.flag && flags.some((flag) => flag.code === known.flag);
              return (
                <li key={entry.source_id}>
                  <span className="cv-source-role">{known.role}</span>
                  <span>
                    {entry.name}{entry.version ? ` (${entry.version})` : ''}
                    {flagged && <em className="cv-unverified">Unverified</em>}
                  </span>
                  {entry.url
                    ? <a href={entry.url} target="_blank" rel="noreferrer">{entry.url}</a>
                    : <small>No source link recorded</small>}
                </li>
              );
            })}
          </ul>
          {unverified.map((code) => (
            <p key={code} className="cv-flag">
              <em className="cv-unverified">Unverified</em>
              {UNVERIFIED_WORDING[code] || 'Part of this data does not have a source recorded yet.'}
            </p>
          ))}
          {meta.built_at_utc && (
            <small>Dataset build {meta.dataset_build_id}, built {formatDateTime(meta.built_at_utc)}.</small>
          )}
        </div>
      </div>
    </section>
  );
};

export default CompareView;
