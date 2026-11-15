// Site comparison numbers come from the Stargazer API (backend/app/routers/compare.py).
// If the API cannot be reached within 1.5 s, a saved copy of the exact same response is used instead.
// There is one saved copy per lunar day the API serves.
import snapshotDay1 from '../data/api_snapshot/compare_lunar_day_1.json';
import snapshotDay2 from '../data/api_snapshot/compare_lunar_day_2.json';
import snapshotDay3 from '../data/api_snapshot/compare_lunar_day_3.json';
import snapshotDay4 from '../data/api_snapshot/compare_lunar_day_4.json';

const API_BASE = (import.meta.env.VITE_STARGAZER_API || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const TIMEOUT_MS = 1500;

export const compareSnapshots = { 1: snapshotDay1, 2: snapshotDay2, 3: snapshotDay3, 4: snapshotDay4 };

/** The lunar days on offer, each with the period (start, end) its saved payload reports. */
export const LUNAR_DAYS = Object.entries(compareSnapshots).map(([day, payload]) => ({
  day: Number(day),
  period: payload.sites[0].period
}));

/** Resolves to { day, payload, source } where source is 'live' or 'snapshot'. Never rejects. */
export async function loadCompare(day) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${API_BASE}/api/v1/compare?lunar_day=${day}&horizon_model=lola_mask`;
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload?.sites) || payload.sites.length === 0) throw new Error('Unexpected response shape');
    return { day, payload, source: 'live' };
  } catch {
    return { day, payload: compareSnapshots[day], source: 'snapshot' };
  } finally {
    clearTimeout(timer);
  }
}

// ---- Formatting shared by the view and the takeaways ----

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (value) => String(value).padStart(2, '0');

export const formatDay = (date) => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
export const formatDate = (value) => {
  const date = new Date(value);
  return `${formatDay(date)} ${date.getUTCFullYear()}`;
};
export const formatDateTime = (value) => {
  const date = new Date(value);
  return `${formatDay(date)} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
};
export const formatCost = (value) => (value == null ? 'n/a' : `$${value.toFixed(2)}M`);

// ---- Takeaways ----

const formatStretch = (hours) => `${Math.round(hours)} hours (about ${(hours / 24).toFixed(1)} days)`;
const listNames = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);
const percent = (fraction) => `${(fraction * 100).toFixed(fraction * 100 < 10 ? 1 : 0)}%`;
// A body counts as "in view for the whole period" when its visible hours fill the period (to within 3 minutes).
const coversPeriod = (site, body) => site.bodies?.[body]?.visible_hours >= site.period.hours - 0.05;
const burnOf = (site) => site.cost?.metrics?.burn_musd_per_usable_h;
const hasBurn = (site) => burnOf(site)?.p10 != null && burnOf(site)?.p50 != null && burnOf(site)?.p90 != null;
const rangeText = (burn) => `${formatCost(burn.p10)} to ${formatCost(burn.p90)}`;
const zeroTrialWarning = (site) => (
  site.cost?.p_zero_usable_hours > 0
    ? `${percent(site.cost.p_zero_usable_hours)} of ${site.name}'s trials had zero usable hours. They are left out of these figures, so the figures skip its worst outcomes.`
    : null
);

/**
 * Plain-English takeaways for the sites given (the ones the user ticked), worked out from the payload only.
 * Returns [{ key, title, text, warning }]. With one site it describes that site instead of comparing.
 */
export function buildInsights(sites) {
  if (sites.length === 0) return [];
  const insights = [];
  const single = sites.length === 1;

  // 1. Longest unbroken stretch with the Sun and Earth both above the skyline.
  const withOverlap = sites.filter((site) => site.best_overlap?.duration_h > 0);
  const withoutOverlap = sites.filter((site) => !withOverlap.includes(site));
  if (withOverlap.length === 0) {
    insights.push({
      key: 'overlap',
      title: 'Sun + Earth together',
      text: single
        ? `${sites[0].name} never has the Sun and Earth above the skyline at the same time in this lunar day.`
        : 'None of the selected sites has the Sun and Earth above the skyline at the same time in this lunar day.'
    });
  } else {
    const ranked = [...withOverlap].sort((a, b) => b.best_overlap.duration_h - a.best_overlap.duration_h);
    const top = ranked[0];
    const tied = ranked.filter((site) => site.best_overlap.duration_h === top.best_overlap.duration_h);
    const stretch = formatStretch(top.best_overlap.duration_h);
    let text;
    if (single) {
      text = `${top.name}'s longest unbroken stretch with the Sun and Earth both in view is ${stretch}, starting ${formatDateTime(top.best_overlap.start_utc)}.`;
    } else if (tied.length > 1) {
      text = `${listNames(tied.map((site) => site.name))} tie for the longest unbroken stretch with the Sun and Earth both in view: ${stretch} each.`;
    } else {
      text = `${top.name} has the longest unbroken stretch with the Sun and Earth both in view: ${stretch}, starting ${formatDateTime(top.best_overlap.start_utc)}.`;
      const next = ranked[1];
      if (next) {
        text += ` That is ${Math.round(top.best_overlap.duration_h - next.best_overlap.duration_h)} hours longer than the next longest, at ${next.name}.`;
      }
    }
    if (!single && withoutOverlap.length > 0) {
      text += ` ${listNames(withoutOverlap.map((site) => site.name))} never ${withoutOverlap.length > 1 ? 'have' : 'has'} both in view together in this lunar day.`;
    }
    insights.push({ key: 'overlap', title: 'Longest Sun + Earth stretch', text });
  }

  // 2. Sun or Earth above the skyline for the whole period.
  const earthAlways = sites.filter((site) => coversPeriod(site, 'earth'));
  const sunAlways = sites.filter((site) => coversPeriod(site, 'sun'));
  if (single) {
    const site = sites[0];
    const share = (body) => (
      coversPeriod(site, body)
        ? 'the whole period'
        : `${Math.round(site.bodies[body].visible_hours)} hours (${percent(site.bodies[body].visible_hours / site.period.hours)} of the period)`
    );
    insights.push({
      key: 'always',
      title: 'Time in view',
      text: `At ${site.name} the Sun is above the skyline for ${share('sun')} and Earth for ${share('earth')}. This is line of sight only, not a promise of power or a radio link.`
    });
  } else if (earthAlways.length + sunAlways.length === 0) {
    insights.push({
      key: 'always',
      title: 'Always in view',
      text: 'None of the selected sites keeps the Sun or Earth above the skyline for the whole of this lunar day.'
    });
  } else {
    const sentence = (group, body) => (
      group.length === 0 ? '' : `${listNames(group.map((site) => site.name))} ${group.length > 1 ? 'keep' : 'keeps'} ${body} above the skyline for the whole period.`
    );
    insights.push({
      key: 'always',
      title: 'Always in view',
      text: `${[sentence(earthAlways, 'Earth'), sentence(sunAlways, 'the Sun')].filter(Boolean).join(' ')} This is line of sight only, not a promise of power or a radio link.`
    });
  }

  // 3 and 4. Cost per usable hour: lowest median, then narrowest P10 to P90 range.
  const costed = sites.filter(hasBurn);
  const uncosted = sites.filter((site) => !costed.includes(site));
  const missing = uncosted.length > 0 ? ` No cost run is available for ${listNames(uncosted.map((site) => site.name))}.` : '';
  if (costed.length === 0) {
    insights.push({ key: 'cost', title: 'Cost per usable hour', text: `No cost run is available for ${single ? 'this site' : 'the selected sites'}.` });
  } else if (single || costed.length === 1) {
    const site = costed[0];
    const burn = burnOf(site);
    insights.push({
      key: 'cost',
      title: 'Cost per usable hour',
      text: `${site.name}'s typical modelled cost per usable hour is ${formatCost(burn.p50)} (the median). Its P10 to P90 range is ${rangeText(burn)}: 8 in 10 of the counted trials fell inside it.${missing}`,
      warning: zeroTrialWarning(site)
    });
  } else {
    const byMedian = [...costed].sort((a, b) => burnOf(a).p50 - burnOf(b).p50);
    const cheapest = byMedian.filter((site) => burnOf(site).p50 === burnOf(byMedian[0]).p50);
    if (cheapest.length > 1) {
      insights.push({
        key: 'cost',
        title: 'Lowest typical cost',
        text: `${listNames(cheapest.map((site) => site.name))} share the lowest typical modelled cost per usable hour: ${formatCost(burnOf(cheapest[0]).p50)} (the median).${missing}`,
        warning: cheapest.map(zeroTrialWarning).filter(Boolean).join(' ') || null
      });
    } else {
      const site = cheapest[0];
      const burn = burnOf(site);
      insights.push({
        key: 'cost',
        title: 'Lowest typical cost',
        text: `${site.name} has the lowest typical modelled cost per usable hour: ${formatCost(burn.p50)} (the median). Its P10 to P90 range is ${rangeText(burn)}: 8 in 10 of the counted trials fell inside it.${missing}`,
        warning: zeroTrialWarning(site)
      });
    }

    const width = (site) => burnOf(site).p90 - burnOf(site).p10;
    const byWidth = [...costed].sort((a, b) => width(a) - width(b));
    // Widths within a rounding error of each other count as a tie.
    const narrowest = byWidth.filter((site) => width(site) - width(byWidth[0]) < 1e-9);
    if (narrowest.length === 1) {
      const site = narrowest[0];
      insights.push({
        key: 'spread',
        title: 'Most predictable cost',
        text: `${site.name} has the narrowest cost range of the selected sites: ${rangeText(burnOf(site))}, a spread of ${formatCost(width(site))} between P10 and P90. A narrower range means the model's cost for it is more predictable.`,
        warning: zeroTrialWarning(site)
      });
    }
  }

  return insights;
}
