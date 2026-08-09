// nutritionAdvisor.mjs
// Sammelt Daten aus Kalorienzähler (nutrition_log) und Blood-Analytics
// (body_composition, blood_values, vo2max_override, Oura/Whoop) und lässt
// Claude die Ernährung gegen 7 Zieldimensionen bewerten: Sport-Performance
// (FTP/VO2max), Muskelaufbau, Regeneration, Immunsystem, Schlaf, ApoB/LDL,
// Gewichtsreduktion. Wird sowohl vom manuellen Trigger
// (nutrition-advisor-background.mjs) als auch vom wöchentlichen
// Scheduled-Trigger (nutrition-advisor-weekly.mjs) genutzt.
//
// Blutwerte/Körperkomposition werden NICHT über eine anon-Read-Policy
// gelesen, sondern per echtem Login (BLOOD_EMAIL/BLOOD_PASSWORD) wie in
// sync-body.mjs — das ist der Admin-Account selbst, RLS greift also ganz
// normal über auth.uid() = user_id, keine neue Policy nötig.

import { repairJSON } from './repairJSON.mjs'
import { summarizeSleepDay } from './nutritionSleepJoin.mjs'

const SUPABASE_URL = 'https://fwsunbqvkvudmgjkjsbh.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3c3VuYnF2a3Z1ZG1namtqc2JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODY0OTEsImV4cCI6MjA4NzE2MjQ5MX0.5bZOef0bZL4U4eAwthM3JZas_AsjDWgsJwKWjO-RB3I'
const NUTRITION_USER_ID = 'cff2bc0d-5205-4a90-8df9-463afe2065d8'
const BLOOD_ANALYTICS_ORIGIN = 'https://blood-analytics.netlify.app'
const NUTRITION_WINDOW_DAYS = 14
const BODY_TREND_WINDOW_DAYS = 60
const RECOVERY_WINDOW_DAYS = 7

// Muss mit DEFAULT_RULES in src/KalorienTracker.jsx synchron gehalten werden
// (Server hat keinen Zugriff auf die client-seitig versionierten Regeln).
const RULES = {
  kcalRestBase: 1900,
  maintenanceBase: 2100,
  referenceDeficit: 200,
  satFatMaxPct: 7,
  fiberGoal: 35,
  macroTrain: { protein: 150, carbs: 200, fat: 85 },
}

const BLOOD_KEYWORDS = ['apolipoprotein b', 'apolipoprotein a', 'ldl', 'hdl', 'cholesterin', 'triglycerid']

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10)
const avg = (arr) => arr.length ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10 : null
const round1 = (n) => n == null ? null : Math.round(n * 10) / 10

async function authenticateBloodAnalytics() {
  const email = Netlify.env.get('BLOOD_EMAIL')
  const password = Netlify.env.get('BLOOD_PASSWORD')
  if (!email || !password) return null
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) return null
    const { access_token } = await res.json()
    return access_token || null
  } catch { return null }
}

async function fetchAuthed(path, accessToken) {
  if (!accessToken) return []
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
    if (!res.ok) return []
    return await res.json()
  } catch { return [] }
}

async function loadTokens(supabase) {
  const { data } = await supabase.from('user_settings')
    .select('key, value').eq('user_id', NUTRITION_USER_ID).in('key', ['oura_token', 'whoop_tokens', 'vo2max_override'])
  const map = Object.fromEntries((data || []).map(r => [r.key, r.value]))
  let ouraToken = null, whoopAccessToken = null
  try { ouraToken = map.oura_token ? JSON.parse(map.oura_token) : null } catch {}
  try {
    const whoop = map.whoop_tokens ? JSON.parse(map.whoop_tokens) : null
    if (whoop?.access_token && (!whoop.expires_at || whoop.expires_at > Math.floor(Date.now() / 1000))) {
      whoopAccessToken = whoop.access_token
    }
  } catch {}
  const vo2max = map.vo2max_override ? parseFloat(map.vo2max_override) : null
  return { ouraToken, whoopAccessToken, vo2max: Number.isFinite(vo2max) ? vo2max : null }
}

async function fetchOura(ouraToken, windowDays) {
  if (!ouraToken) return []
  try {
    const res = await fetch(`${BLOOD_ANALYTICS_ORIGIN}/api/oura-sleep`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ouraToken, startDate: isoDate(Date.now() - windowDays * 86400000), endDate: isoDate(Date.now()) }),
    })
    if (!res.ok) return []
    return (await res.json()).days || []
  } catch { return [] }
}

async function fetchWhoop(whoopAccessToken, windowDays) {
  if (!whoopAccessToken) return []
  try {
    const res = await fetch(`${BLOOD_ANALYTICS_ORIGIN}/api/whoop-data`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: whoopAccessToken, startDate: isoDate(Date.now() - windowDays * 86400000), endDate: isoDate(Date.now()) }),
    })
    if (!res.ok) return []
    return (await res.json()).days || []
  } catch { return [] }
}

// ── Daten sammeln ────────────────────────────────────────────────────────────
async function gatherAdvisorData(supabase) {
  const sinceNutrition = isoDate(Date.now() - NUTRITION_WINDOW_DAYS * 86400000)

  const [{ data: nutritionRows }, { data: sickRows }, bloodAccessToken] = await Promise.all([
    supabase.from('nutrition_log')
      .select('date, total_kcal, protein_g, carbs_g, carbs_complex_g, carbs_simple_g, fat_g, fat_saturated_g, fat_unsaturated_g, fiber_g, caffeine_mg, kcal_goal, meals')
      .eq('user_id', NUTRITION_USER_ID).gte('date', sinceNutrition).order('date', { ascending: true }),
    supabase.from('sick_days').select('date').eq('user_id', NUTRITION_USER_ID),
    authenticateBloodAnalytics(),
  ])

  const sickDates = new Set((sickRows || []).map(r => r.date))
  const cleanNutrition = (nutritionRows || []).filter(r => !sickDates.has(r.date))

  const { ouraToken, whoopAccessToken, vo2max } = await loadTokens(supabase)

  const [bodyRows, bloodRows, ouraDays, whoopDays] = await Promise.all([
    fetchAuthed(
      `body_composition?select=measured_at,weight,body_fat_pct,muscle_mass,visceral_fat&order=measured_at.asc&measured_at=gte.${isoDate(Date.now() - BODY_TREND_WINDOW_DAYS * 86400000)}`,
      bloodAccessToken
    ),
    fetchAuthed(`blood_values?select=parameter_name,value,unit,status,created_at&order=created_at.desc&limit=500`, bloodAccessToken),
    fetchOura(ouraToken, RECOVERY_WINDOW_DAYS),
    fetchWhoop(whoopAccessToken, RECOVERY_WINDOW_DAYS),
  ])

  // Neuesten Wert pro Blutwert-Parameter behalten (Liste ist bereits nach created_at DESC sortiert)
  const relevantBlood = new Map()
  for (const row of bloodRows) {
    const name = (row.parameter_name || '').toLowerCase()
    if (!BLOOD_KEYWORDS.some(k => name.includes(k))) continue
    if (!relevantBlood.has(row.parameter_name)) relevantBlood.set(row.parameter_name, row)
  }

  return {
    nutritionDays: cleanNutrition,
    excludedSickDays: (nutritionRows || []).length - cleanNutrition.length,
    bodyRows,
    bloodValues: [...relevantBlood.values()],
    vo2max,
    ouraDays,
    whoopDays,
  }
}

// ── Aggregation ──────────────────────────────────────────────────────────────
function aggregate(data) {
  const n = data.nutritionDays
  const eveningOf = (row, field) => (row.meals || [])
    .filter(m => !m.isAutoCorrection && m.time >= '18:00')
    .reduce((s, m) => s + (m[field] || 0), 0)
  const caffeineAfter13Of = (row) => (row.meals || [])
    .filter(m => !m.isAutoCorrection && m.time >= '13:00')
    .reduce((s, m) => s + (m.caffeine || 0), 0)

  // Lebensmittelqualität: healthScore (1=sehr gesund/unverarbeitet … 6=sehr ungesund/stark
  // verarbeitet) wird schon pro Mahlzeit von der Foto-/Text-Analyse vergeben und in nutrition_log
  // mitgespeichert — hier nur aggregiert, keine neue KI-Bewertung nötig.
  const allMeals = n.flatMap(r => (r.meals || []).filter(m => !m.isAutoCorrection && m.healthScore != null))
  const foodQuality = allMeals.length ? {
    mealsRated: allMeals.length,
    avgHealthScore: avg(allMeals.map(m => m.healthScore)),
    processedCount: allMeals.filter(m => m.healthScore >= 5).length,
    processedPct: Math.round((allMeals.filter(m => m.healthScore >= 5).length / allMeals.length) * 100),
    worstExamples: [...allMeals].sort((a, b) => b.healthScore - a.healthScore)
      .filter((m, i, arr) => arr.findIndex(x => x.name === m.name) === i)
      .slice(0, 6).map(m => `${m.name} (${m.healthScore}/6)`),
  } : null

  const nutrition = n.length ? {
    days: n.length,
    kcalAvg: avg(n.map(r => r.total_kcal || 0)),
    kcalGoalAvg: avg(n.map(r => r.kcal_goal || 0)),
    proteinAvg: avg(n.map(r => r.protein_g || 0)),
    carbsComplexAvg: avg(n.map(r => r.carbs_complex_g || 0)),
    carbsSimpleAvg: avg(n.map(r => r.carbs_simple_g || 0)),
    fatSaturatedAvg: avg(n.map(r => r.fat_saturated_g || 0)),
    fatUnsaturatedAvg: avg(n.map(r => r.fat_unsaturated_g || 0)),
    fiberAvg: avg(n.map(r => r.fiber_g || 0)),
    caffeineAvg: avg(n.map(r => r.caffeine_mg || 0)),
    caffeineAfter13Avg: avg(n.map(caffeineAfter13Of)),
    eveningKcalAvg: avg(n.map(r => eveningOf(r, 'kcal'))),
    eveningProteinAvg: avg(n.map(r => eveningOf(r, 'protein'))),
  } : null

  const bc = data.bodyRows || []
  const bodyComp = bc.length ? {
    latestDate: bc[bc.length - 1].measured_at?.slice(0, 10) || null,
    weight: round1(bc[bc.length - 1].weight),
    weightDelta: bc.length > 1 ? round1(bc[bc.length - 1].weight - bc[0].weight) : null,
    fatPct: round1(bc[bc.length - 1].body_fat_pct),
    fatPctDelta: bc.length > 1 && bc[0].body_fat_pct != null ? round1(bc[bc.length - 1].body_fat_pct - bc[0].body_fat_pct) : null,
    muscleMassKg: round1(bc[bc.length - 1].muscle_mass),
    muscleMassDelta: bc.length > 1 && bc[0].muscle_mass != null ? round1(bc[bc.length - 1].muscle_mass - bc[0].muscle_mass) : null,
    visceralFat: round1(bc[bc.length - 1].visceral_fat),
    trendWindowDays: BODY_TREND_WINDOW_DAYS,
  } : null

  const blood = data.bloodValues.map(b => ({
    name: b.parameter_name, value: b.value, unit: b.unit, status: b.status, date: b.created_at?.slice(0, 10),
  }))

  const recovery = (() => {
    const whoopByDay = new Map(data.whoopDays.map(d => [d.day, d]))
    const ouraByDay = new Map(data.ouraDays.map(d => [d.day, d]))
    const allDates = new Set([...whoopByDay.keys(), ...ouraByDay.keys()])
    const hrv = [], recScore = [], sleepEff = []
    for (const date of allDates) {
      const sleep = summarizeSleepDay(whoopByDay.get(date), ouraByDay.get(date))
      if (!sleep) continue
      if (sleep.hrv != null) hrv.push(sleep.hrv)
      if (sleep.recoveryScore != null) recScore.push(sleep.recoveryScore)
      if (sleep.sleepEfficiency != null) sleepEff.push(sleep.sleepEfficiency)
    }
    if (!hrv.length && !recScore.length && !sleepEff.length) return null
    return { hrvAvg: avg(hrv), recoveryScoreAvg: avg(recScore), sleepEfficiencyAvg: avg(sleepEff), windowDays: RECOVERY_WINDOW_DAYS }
  })()

  return { nutrition, foodQuality, bodyComp, blood, vo2max: data.vo2max, recovery, excludedSickDays: data.excludedSickDays }
}

// ── Prompt ───────────────────────────────────────────────────────────────────
function buildPrompt(agg) {
  const n = agg.nutrition
  const nutritionBlock = n
    ? `Ø letzte ${n.days} Tage (Krankheitstage ausgeschlossen${agg.excludedSickDays ? `, ${agg.excludedSickDays} Tage ausgeschlossen` : ''}):
- Kalorien: ${n.kcalAvg} kcal (tatsächliches Tagesziel im Schnitt: ${n.kcalGoalAvg} kcal — dieses Ziel schwankt schon TAG FÜR TAG mit dem Training, siehe Kalorienziel-Mechanik unten)
- Protein: ${n.proteinAvg} g
- Kohlenhydrate: ${n.carbsComplexAvg} g komplex + ${n.carbsSimpleAvg} g einfach
- Fett: ${n.fatSaturatedAvg} g gesättigt (Grenze für LDL-Ziel: ${RULES.satFatMaxPct}% der Kalorien) + ${n.fatUnsaturatedAvg} g ungesättigt
- Ballaststoffe: ${n.fiberAvg} g (Ziel ${RULES.fiberGoal} g)
- Koffein: Ø ${n.caffeineAvg} mg/Tag, davon Ø ${n.caffeineAfter13Avg} mg nach 13 Uhr
- Abend (ab 18 Uhr): Ø ${n.eveningKcalAvg} kcal, ${n.eveningProteinAvg} g Protein
- Referenz-Trainingsziele: ${RULES.macroTrain.protein}g Protein / ${RULES.macroTrain.carbs}g Carbs / ${RULES.macroTrain.fat}g Fett

KALORIENZIEL-MECHANIK (wichtig, um das Ziel richtig einzuordnen): Basis an Ruhetagen ${RULES.kcalRestBase} kcal, Erhaltungskalorien ${RULES.maintenanceBase} kcal. An JEDEM Trainingstag wird das Tagesziel automatisch 1:1 um die vollen an dem Tag verbrannten Trainingskalorien erhöht (keine Kürzung, kein Deckel) — das Ziel ist also bewusst kein fixer Wert, sondern steigt mit der Trainingslast. Das Defizit bleibt dadurch an JEDEM Tag konstant bei ${RULES.referenceDeficit} kcal, egal wie viel trainiert wurde. Der Ruhetag-Basiswert (${RULES.kcalRestBase} kcal) ist absichtlich niedrig gewählt und KEIN Hinweis auf zu wenig Energiezufuhr — bewerte ausschließlich das oben genannte tatsächliche Ø-Tagesziel (${n.kcalGoalAvg} kcal) im Vergleich zur Ø-Kalorienaufnahme, nicht die Ruhetag-Basis.`
    : 'Keine Ernährungsdaten im Zeitraum vorhanden.'

  const bodyBlock = agg.bodyComp
    ? `Stand ${agg.bodyComp.latestDate} (Trend über ${agg.bodyComp.trendWindowDays} Tage): Gewicht ${agg.bodyComp.weight}kg (${agg.bodyComp.weightDelta != null ? (agg.bodyComp.weightDelta >= 0 ? '+' : '') + agg.bodyComp.weightDelta + 'kg' : 'kein Trend'}), Körperfett ${agg.bodyComp.fatPct}% (${agg.bodyComp.fatPctDelta != null ? (agg.bodyComp.fatPctDelta >= 0 ? '+' : '') + agg.bodyComp.fatPctDelta + '%pt' : 'kein Trend'}), Muskelmasse ${agg.bodyComp.muscleMassKg}kg (${agg.bodyComp.muscleMassDelta != null ? (agg.bodyComp.muscleMassDelta >= 0 ? '+' : '') + agg.bodyComp.muscleMassDelta + 'kg' : 'kein Trend'}), viszerales Fett ${agg.bodyComp.visceralFat}`
    : 'Keine Körperkompositionsdaten vorhanden.'

  const bloodBlock = agg.blood.length
    ? agg.blood.map(b => `${b.name}: ${b.value} ${b.unit || ''} (${b.status || 'kein Status'}, vom ${b.date})`).join('\n')
    : 'Keine relevanten Blutwerte (ApoB/LDL/HDL/Cholesterin) vorhanden.'

  const foodQualityBlock = agg.foodQuality
    ? `Ø Health-Score ${agg.foodQuality.avgHealthScore}/6 (1=sehr gesund/unverarbeitet, 6=sehr ungesund/stark verarbeitet), aus ${agg.foodQuality.mealsRated} bewerteten Mahlzeiten. ${agg.foodQuality.processedCount} Mahlzeiten (${agg.foodQuality.processedPct}%) mit Score ≥5 (ungesund/stark verarbeitet).${agg.foodQuality.worstExamples.length ? `\nSchlechteste bewertete Mahlzeiten im Zeitraum: ${agg.foodQuality.worstExamples.join(', ')}` : ''}`
    : 'Keine Health-Score-Daten zu den einzelnen Mahlzeiten vorhanden.'

  const vo2maxBlock = agg.vo2max != null ? `VO2max (aktuell hinterlegt): ${agg.vo2max} ml/kg/min` : 'Kein VO2max-Wert hinterlegt.'

  const recoveryBlock = agg.recovery
    ? `Ø letzte ${agg.recovery.windowDays} Tage: HRV ${agg.recovery.hrvAvg ?? '–'}, Recovery/Readiness-Score ${agg.recovery.recoveryScoreAvg ?? '–'}, Schlafeffizienz ${agg.recovery.sleepEfficiencyAvg ?? '–'}%`
    : 'Keine Oura/Whoop-Daten verfügbar.'

  return `Du bist ein sportmedizinisch versierter Ernährungsberater für einen ambitionierten Ausdauerathleten (Triathlon). Bewerte seine Ernährung anhand der folgenden Daten gegen SEINE 8 explizit genannten Ziele. Sei konkret und datenbasiert — jede Empfehlung muss sich auf eine der unten stehenden Zahlen beziehen, keine generischen Ernährungstipps.

ERNÄHRUNG:
${nutritionBlock}

LEBENSMITTELQUALITÄT (Health-Score je Mahlzeit, bereits bei der Erfassung von der Foto-/Text-Analyse vergeben):
${foodQualityBlock}

KÖRPERKOMPOSITION:
${bodyBlock}

BLUTWERTE:
${bloodBlock}

LEISTUNGSFÄHIGKEIT:
${vo2maxBlock}

SCHLAF/REGENERATION (Oura/Whoop):
${recoveryBlock}

SEINE 8 ZIELE (in dieser Reihenfolge bewerten):
1. performance — Sport-Performance verbessern (FTP & VO2max)
2. muscleBuild — Muskeln aufbauen
3. recovery — bessere Regeneration
4. immune — starkes Immunsystem
5. sleep — guter Schlaf
6. apoB — niedriges ApoB-Cholesterin
7. weightLoss — Gewicht leicht reduzieren
8. foodQuality — Lebensmittelqualität für Longevity: möglichst wenig hochverarbeitete Lebensmittel, hohe Nährstoffdichte (Vollwertkost, Gemüse, gute Proteinquellen), möglichst wenig gesättigte Fette. Nutze explizit den Health-Score und die genannten Beispiel-Mahlzeiten oben — benenne konkrete Lebensmittel/Muster, die ersetzt werden sollten, nicht nur die Zahl. WICHTIGE AUSNAHME: Sportnahrung während/kurz um Trainingseinheiten (Gels, isotonische Getränke, Sportriegel, Bananen, Maltodextrin, schnelle Kohlenhydrate zur Wettkampf-/Trainingsversorgung) ist bei einem Ausdauerathleten funktional sinnvoll und darf NICHT als schlechte Ernährung gewertet werden, selbst wenn der automatisch vergebene Health-Score niedrig ist (der Score kennt den Trainingskontext nicht). Erkenne solche Fälle an Name/Beschreibung der Mahlzeit und schließe sie aus der Bewertung aus — flagge nur Muster, die klar NICHT trainingsbezogen sind (z.B. Fast Food, Süßigkeiten, Snacks im Alltag ohne erkennbaren Sportbezug).

WICHTIG: Mehrere dieser Ziele stehen im Konflikt (z.B. Kaloriendefizit vs. Muskelaufbau vs. Performance). Wäge das explizit ab statt die Ziele isoliert zu betrachten — wenn ein Zielkonflikt besteht, benenne ihn und schlage einen Kompromiss vor (z.B. Defizit nur an Ruhetagen, volle Energie an harten Einheiten).

Falls für ein Ziel keine ausreichenden Daten vorhanden sind, sag das ehrlich (status "unklar") statt zu spekulieren.

Antworte NUR mit diesem JSON (kein Markdown, keine Kommentare):
{
  "summary": "3-4 Sätze Gesamtbild",
  "goals": {
    "performance":  {"status":"gut|beachten|kritisch|unklar","assessment":"1-2 Sätze, datenbasiert","actions":["konkrete Handlung 1","konkrete Handlung 2"]},
    "muscleBuild":  {"status":"...","assessment":"...","actions":["...","..."]},
    "recovery":     {"status":"...","assessment":"...","actions":["...","..."]},
    "immune":       {"status":"...","assessment":"...","actions":["...","..."]},
    "sleep":        {"status":"...","assessment":"...","actions":["...","..."]},
    "apoB":         {"status":"...","assessment":"...","actions":["...","..."]},
    "weightLoss":   {"status":"...","assessment":"...","actions":["...","..."]},
    "foodQuality":  {"status":"...","assessment":"...","actions":["...","..."]}
  },
  "conflicts": "1-2 Sätze zu Zielkonflikten und wie sie aufgelöst werden sollten, leer falls keiner erkennbar",
  "topPriorities": ["Priorität 1 diese Woche","Priorität 2","Priorität 3"]
}`
}

// ── Orchestrierung ───────────────────────────────────────────────────────────
export async function runNutritionAdvisor(supabase, apiKey) {
  const data = await gatherAdvisorData(supabase)
  const agg = aggregate(data)

  if (!agg.nutrition || agg.nutrition.days < 3) {
    return {
      summary: `Nur ${agg.nutrition?.days || 0} Tage Ernährungsdaten im Zeitraum — das reicht nicht für eine sinnvolle Bewertung. Mindestens 3, besser 7+ Tage werden gebraucht.`,
      goals: null,
      conflicts: null,
      topPriorities: [],
      coverage: agg,
    }
  }

  const prompt = buildPrompt(agg)

  const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5', max_tokens: 3072,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!claudeResponse.ok) {
    const errText = await claudeResponse.text()
    throw new Error(`Claude API Fehler ${claudeResponse.status}: ${errText.slice(0, 300)}`)
  }

  const responseData = await claudeResponse.json()
  const raw = (responseData.content?.[0]?.text || '').trim()
  if (!raw) throw new Error('Leere Antwort von Claude.')

  const parsed = repairJSON(raw)
  if (!parsed || !parsed.goals) throw new Error('Unerwartete oder nicht parsbare JSON-Struktur von Claude.')

  return { ...parsed, coverage: agg }
}
