// nutritionSleepJoin.js
// Shared join/statistics logic for the "Ernährung × Schlaf/Recovery"
// feature. Used by both the quick 30-day view and the deep background
// analysis so the two never disagree on what counts as a valid day-pair.
//
// Join rule: nutrition eaten on date D is compared against sleep/recovery
// attributed to date D+1 — Oura and Whoop both attribute a night's sleep
// and the following recovery score to the wake-up day, so "D+1" is the
// morning after the food was eaten on D.

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function timeToMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== 'string') return null
  const [h, m] = hhmm.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  return h * 60 + m
}

function minutesToTime(mins) {
  if (mins == null || mins < 0) return null
  const h = Math.floor(mins / 60)
  const m = Math.round(mins % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// Reduces one nutrition_log row (with .meals jsonb) to the metrics we
// correlate against next-day sleep. Returns null for days with no real
// meals (auto-correction placeholder only, or empty) — those must never
// feed the correlation, same rule as the Kalorienzähler sync guard that
// prevents placeholder days from ever reaching Supabase as real data.
export function summarizeNutritionDay(row) {
  const meals = (row.meals || []).filter(m => !m.isAutoCorrection)
  if (meals.length === 0) return null

  const lastMealMinutes = meals.reduce((max, m) => {
    const t = timeToMinutes(m.time)
    return t != null && t > max ? t : max
  }, -1)

  const lateMeals = meals.filter(m => {
    const t = timeToMinutes(m.time)
    return t != null && t >= 20 * 60 // ab 20:00 Uhr
  })
  const lateCarbsG = lateMeals.reduce((s, m) => s + (m.carbs || 0), 0)
  const lateKcal = lateMeals.reduce((s, m) => s + (m.kcal || 0), 0)

  // Koffein wirkt zeitkritisch (Halbwertszeit ~5-6h) — eigener, früherer
  // Cutoff (14 Uhr) als bei später Nahrung generell (20 Uhr).
  const afternoonMeals = meals.filter(m => {
    const t = timeToMinutes(m.time)
    return t != null && t >= 14 * 60
  })
  const lateCaffeineMg = afternoonMeals.reduce((s, m) => s + (m.caffeine || 0), 0)
  const caffeineMg = meals.reduce((s, m) => s + (m.caffeine || 0), 0)

  return {
    date: row.date,
    kcal: row.total_kcal ?? null,
    kcalGoal: row.kcal_goal ?? null,
    kcalDelta: row.total_kcal != null && row.kcal_goal != null ? row.total_kcal - row.kcal_goal : null,
    proteinG: row.protein_g ?? null,
    carbsG: row.carbs_g ?? null,
    fatG: row.fat_g ?? null,
    fiberG: row.fiber_g ?? null,
    waterMl: row.water_ml ?? null,
    caffeineMg: row.caffeine_mg ?? Math.round(caffeineMg),
    lateCaffeineMg: Math.round(lateCaffeineMg),
    mealCount: meals.length,
    lastMealTime: lastMealMinutes >= 0 ? minutesToTime(lastMealMinutes) : null,
    lastMealMinutes: lastMealMinutes >= 0 ? lastMealMinutes : null,
    lateCarbsG: Math.round(lateCarbsG * 10) / 10,
    lateKcal: Math.round(lateKcal),
  }
}

// Picks Whoop as primary, Oura as fallback per metric — matches the
// documented convention in recoveryModel.js ("Whoop is the primary
// device"). Returns null if neither source has data for that day.
export function summarizeSleepDay(whoopDay, ouraDay) {
  if (!whoopDay && !ouraDay) return null
  const sleepH = whoopDay?.whoop_sleep_h ??
    (ouraDay?.total_sleep_duration != null ? Math.round(ouraDay.total_sleep_duration / 360) / 10 : null)
  const deepH = whoopDay?.whoop_deep_h ??
    (ouraDay?.deep_sleep_duration != null ? Math.round(ouraDay.deep_sleep_duration / 360) / 10 : null)
  const remH = whoopDay?.whoop_rem_h ??
    (ouraDay?.rem_sleep_duration != null ? Math.round(ouraDay.rem_sleep_duration / 360) / 10 : null)

  return {
    date: (whoopDay || ouraDay).day,
    source: whoopDay ? (ouraDay ? 'whoop+oura' : 'whoop') : 'oura',
    recoveryScore: whoopDay?.whoop_recovery ?? ouraDay?.readiness_score ?? null,
    hrv: whoopDay?.whoop_hrv ?? ouraDay?.average_hrv ?? null,
    rhr: whoopDay?.whoop_rhr ?? ouraDay?.average_heart_rate ?? null,
    sleepEfficiency: whoopDay?.whoop_sleep_efficiency ?? ouraDay?.efficiency ?? null,
    sleepPerformance: whoopDay?.whoop_sleep_performance ?? ouraDay?.sleep_score ?? null,
    sleepH,
    deepH,
    remH,
    respiratoryRate: whoopDay?.whoop_respiratory_rate ?? null,
  }
}

// Builds the day-pair list: nutrition on date D joined with sleep/recovery
// on date D+1. `sickDates` is a plain array of 'YYYY-MM-DD' strings; a pair
// is excluded from analysis if EITHER the eating day or the following
// sleep day was marked sick — illness confounds both sides of the pair.
export function buildDayPairs({ nutritionRows = [], whoopDays = [], ouraDays = [], sickDates = [] }) {
  const sick = new Set(sickDates)
  const whoopByDay = new Map(whoopDays.map(d => [d.day, d]))
  const ouraByDay = new Map(ouraDays.map(d => [d.day, d]))

  const pairs = []
  for (const row of nutritionRows) {
    const nutrition = summarizeNutritionDay(row)
    if (!nutrition) continue
    const nextDay = addDays(row.date, 1)
    const sleep = summarizeSleepDay(whoopByDay.get(nextDay), ouraByDay.get(nextDay))
    const sickNutritionDay = sick.has(row.date)
    const sickSleepDay = sick.has(nextDay)
    let excludeReason = null
    if (sickNutritionDay) excludeReason = 'krank (Ernährungstag)'
    else if (sickSleepDay) excludeReason = 'krank (Folgetag)'
    else if (!sleep) excludeReason = 'keine Schlafdaten'

    pairs.push({
      nutritionDate: row.date,
      sleepDate: nextDay,
      nutrition,
      sleep,
      excluded: !!excludeReason,
      excludeReason,
    })
  }
  return pairs.sort((a, b) => b.nutritionDate.localeCompare(a.nutritionDate))
}

// Pearson correlation coefficient. Requires at least 5 valid points —
// below that the number is noise, not a pattern.
export function pearson(xs, ys) {
  const pts = xs.map((x, i) => [x, ys[i]]).filter(
    ([x, y]) => x != null && y != null && !Number.isNaN(x) && !Number.isNaN(y)
  )
  if (pts.length < 5) return null
  const n = pts.length
  const mx = pts.reduce((s, [x]) => s + x, 0) / n
  const my = pts.reduce((s, [, y]) => s + y, 0) / n
  let num = 0, dx2 = 0, dy2 = 0
  for (const [x, y] of pts) {
    const dx = x - mx, dy = y - my
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy
  }
  const denom = Math.sqrt(dx2 * dy2)
  if (denom === 0) return null
  return { r: Math.round((num / denom) * 100) / 100, n }
}

const NUTRITION_FEATURES = [
  ['kcalDelta',        p => p.nutrition.kcalDelta,        'Kalorien-Über-/Unterschuss'],
  ['carbsG',           p => p.nutrition.carbsG,           'Kohlenhydrate (g)'],
  ['fatG',             p => p.nutrition.fatG,             'Fett (g)'],
  ['fiberG',           p => p.nutrition.fiberG,           'Ballaststoffe (g)'],
  ['lateCarbsG',       p => p.nutrition.lateCarbsG,       'Kohlenhydrate nach 20 Uhr (g)'],
  ['lastMealMinutes',  p => p.nutrition.lastMealMinutes,  'Uhrzeit letzte Mahlzeit'],
  ['waterMl',          p => p.nutrition.waterMl,          'Wasser (ml)'],
  ['caffeineMg',       p => p.nutrition.caffeineMg,       'Koffein gesamt (mg)'],
  ['lateCaffeineMg',   p => p.nutrition.lateCaffeineMg,   'Koffein nach 14 Uhr (mg)'],
]

const SLEEP_FEATURES = [
  ['hrv',             p => p.sleep.hrv,             'HRV'],
  ['recoveryScore',   p => p.sleep.recoveryScore,   'Recovery/Readiness-Score'],
  ['sleepEfficiency', p => p.sleep.sleepEfficiency, 'Sleep Efficiency'],
  ['rhr',             p => p.sleep.rhr,             'Ruhepuls'],
  ['deepH',           p => p.sleep.deepH,           'Tiefschlaf (h)'],
]

// Full feature-pair correlation matrix — same feature set for the quick
// and deep analysis, deep just runs it over a much larger n.
export function computeCorrelations(validPairs) {
  const results = []
  for (const [nKey, nGet, nLabel] of NUTRITION_FEATURES) {
    for (const [sKey, sGet, sLabel] of SLEEP_FEATURES) {
      const corr = pearson(validPairs.map(nGet), validPairs.map(sGet))
      if (corr) results.push({ nutrition: nKey, nutritionLabel: nLabel, sleep: sKey, sleepLabel: sLabel, ...corr })
    }
  }
  return results.sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
}

// Binary-split comparison (e.g. "späte Mahlzeit ja/nein") — more robust
// than Pearson at small n and easier for the AI/user to interpret.
export function binnedComparison(validPairs, predicate, label) {
  const withFeature = validPairs.filter(p => predicate(p) === true)
  const withoutFeature = validPairs.filter(p => predicate(p) === false)
  const avg = (arr, get) => {
    const v = arr.map(get).filter(x => x != null && !Number.isNaN(x))
    return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null
  }
  return {
    label,
    nWith: withFeature.length,
    nWithout: withoutFeature.length,
    hrv: { with: avg(withFeature, p => p.sleep.hrv), without: avg(withoutFeature, p => p.sleep.hrv) },
    recoveryScore: { with: avg(withFeature, p => p.sleep.recoveryScore), without: avg(withoutFeature, p => p.sleep.recoveryScore) },
    sleepEfficiency: { with: avg(withFeature, p => p.sleep.sleepEfficiency), without: avg(withoutFeature, p => p.sleep.sleepEfficiency) },
  }
}

export const STANDARD_BINS = [
  { label: 'Späte Mahlzeit (letzte Mahlzeit nach 21 Uhr)', predicate: p => p.nutrition.lastMealMinutes != null ? p.nutrition.lastMealMinutes >= 21 * 60 : null },
  { label: 'Kalorienüberschuss (über Tagesziel)', predicate: p => p.nutrition.kcalDelta != null ? p.nutrition.kcalDelta > 0 : null },
  { label: 'Wenig Ballaststoffe (< 20g)', predicate: p => p.nutrition.fiberG != null ? p.nutrition.fiberG < 20 : null },
  { label: 'Viele späte Kohlenhydrate (> 40g nach 20 Uhr)', predicate: p => p.nutrition.lateCarbsG != null ? p.nutrition.lateCarbsG > 40 : null },
  { label: 'Koffein nach 14 Uhr', predicate: p => p.nutrition.lateCaffeineMg != null ? p.nutrition.lateCaffeineMg > 0 : null },
  { label: 'Hoher Koffeinkonsum (> 200mg/Tag)', predicate: p => p.nutrition.caffeineMg != null ? p.nutrition.caffeineMg > 200 : null },
]

export { addDays, timeToMinutes, minutesToTime }
