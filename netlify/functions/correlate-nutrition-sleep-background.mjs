// correlate-nutrition-sleep-background.mjs
// Tiefenanalyse über die komplette Ernährungs-/Schlaf-Historie. Background-
// Function (kein Response an den Client, Ergebnis landet in analysis_jobs —
// dieselbe Tabelle, die auch Blood-Analytics für seine KI-Analysen nutzt).
//
// Oura/Whoop-Rohdaten kommen server-zu-server von den bereits deployten
// Blood-Analytics-Proxy-Functions; die Tokens liegen in user_settings,
// synchronisiert von der Blood-Analytics-App. Der Whoop-Access-Token wird
// NIE selbst refresht (siehe nutrition-sleep-quick.mjs) — ist er abgelaufen,
// läuft die Analyse einfach ohne Whoop-Daten für den betroffenen Zeitraum.

import { createClient } from '@supabase/supabase-js'
import { buildDayPairs, computeCorrelations, binnedComparison, STANDARD_BINS } from './lib/nutritionSleepJoin.mjs'
import { repairJSON } from './lib/repairJSON.mjs'

const SUPABASE_URL = 'https://fwsunbqvkvudmgjkjsbh.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3c3VuYnF2a3Z1ZG1namtqc2JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODY0OTEsImV4cCI6MjA4NzE2MjQ5MX0.5bZOef0bZL4U4eAwthM3JZas_AsjDWgsJwKWjO-RB3I'
const NUTRITION_USER_ID = 'cff2bc0d-5205-4a90-8df9-463afe2065d8'
const BLOOD_ANALYTICS_ORIGIN = 'https://blood-analytics.netlify.app'
const DEEP_WINDOW_DAYS = 730 // ~2 Jahre

const isoDate = (ms) => new Date(ms).toISOString().slice(0, 10)

async function loadTokens(supabase) {
  const { data } = await supabase.from('user_settings')
    .select('key, value').eq('user_id', NUTRITION_USER_ID).in('key', ['oura_token', 'whoop_tokens'])
  const map = Object.fromEntries((data || []).map(r => [r.key, r.value]))
  let ouraToken = null, whoopAccessToken = null
  try { ouraToken = map.oura_token ? JSON.parse(map.oura_token) : null } catch {}
  try {
    const whoop = map.whoop_tokens ? JSON.parse(map.whoop_tokens) : null
    if (whoop?.access_token && (!whoop.expires_at || whoop.expires_at > Math.floor(Date.now() / 1000))) {
      whoopAccessToken = whoop.access_token
    }
  } catch {}
  return { ouraToken, whoopAccessToken }
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

export default async (req) => {
  let jobId = null
  let supabase = null

  try {
    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY fehlt')

    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

    const body = await req.json()
    jobId = body.jobId
    if (!jobId) throw new Error('Kein jobId übergeben.')

    const updateJob = async (status, result = null, error = null) => {
      await supabase.from('analysis_jobs').update({
        status, result, error, updated_at: new Date().toISOString(),
      }).eq('id', jobId)
    }
    await updateJob('processing')

    const { data: nutritionRows, error: nutErr } = await supabase
      .from('nutrition_log')
      .select('date, total_kcal, protein_g, carbs_g, fat_g, fiber_g, water_ml, caffeine_mg, kcal_goal, meals')
      .eq('user_id', NUTRITION_USER_ID)
      .order('date', { ascending: true })
      .limit(2000)
    if (nutErr) throw nutErr

    const { data: sickRows } = await supabase.from('sick_days').select('date').eq('user_id', NUTRITION_USER_ID)
    const sickDates = (sickRows || []).map(r => r.date)

    const { ouraToken, whoopAccessToken } = await loadTokens(supabase)
    const [ouraDays, whoopDays] = await Promise.all([
      fetchOura(ouraToken, DEEP_WINDOW_DAYS),
      fetchWhoop(whoopAccessToken, DEEP_WINDOW_DAYS),
    ])

    const allPairs = buildDayPairs({ nutritionRows: nutritionRows || [], whoopDays, ouraDays, sickDates })
    const validPairs = allPairs.filter(p => !p.excluded)

    if (validPairs.length < 5) {
      await updateJob('done', {
        analysis: {
          zusammenfassung: `Nur ${validPairs.length} vollständige Tage (Ernährung + Schlaf/Recovery am Folgetag, ohne Krankheitstage) verfügbar — das reicht statistisch nicht für belastbare Muster. Mindestens 5, besser 20+ Tage werden für eine sinnvolle Tiefenanalyse gebraucht.`,
          muster: [],
          top_empfehlungen: [],
        },
        coverage: {
          totalPairs: allPairs.length,
          validPairs: validPairs.length,
          excludedPairs: allPairs.length - validPairs.length,
          dateRange: allPairs.length ? [allPairs[allPairs.length - 1].nutritionDate, allPairs[0].nutritionDate] : null,
        },
      })
      return
    }

    const correlations = computeCorrelations(validPairs)
    const bins = STANDARD_BINS.map(b => binnedComparison(validPairs, b.predicate, b.label))
      .filter(b => b.nWith >= 3 && b.nWithout >= 3)

    const excludedByReason = allPairs.filter(p => p.excluded).reduce((acc, p) => {
      acc[p.excludeReason] = (acc[p.excludeReason] || 0) + 1
      return acc
    }, {})

    const corrTable = correlations.slice(0, 15).map(c =>
      `${c.nutritionLabel} ↔ ${c.sleepLabel}: r=${c.r} (n=${c.n})`
    ).join('\n') || 'Keine Korrelation mit ausreichend Datenpunkten (n≥5).'

    const binTable = bins.map(b =>
      `${b.label} (n=${b.nWith} vs. n=${b.nWithout} ohne): HRV ${b.hrv.with ?? '–'} vs. ${b.hrv.without ?? '–'} · ` +
      `Recovery ${b.recoveryScore.with ?? '–'} vs. ${b.recoveryScore.without ?? '–'} · ` +
      `SleepEff ${b.sleepEfficiency.with ?? '–'} vs. ${b.sleepEfficiency.without ?? '–'}`
    ).join('\n') || 'Keine Gruppenvergleiche mit ausreichend Tagen in beiden Gruppen (n≥3).'

    const dateRange = `${allPairs[allPairs.length - 1].nutritionDate} bis ${allPairs[0].nutritionDate}`

    const prompt = `Du bist Ernährungs- und Schlafwissenschaftler. Analysiere den Zusammenhang zwischen Ernährung (Tag D) und Schlaf/Regeneration (Folgetag D+1, aus Whoop/Oura) über einen längeren Zeitraum.

DATENBASIS: ${validPairs.length} valide Tage von ${dateRange} (${allPairs.length} Tage insgesamt, davon ausgeschlossen: ${JSON.stringify(excludedByReason)}).

KORRELATIONEN (Pearson r, -1 bis +1, |r|>0,3 gilt als bemerkenswert, n=Anzahl Tage):
${corrTable}

GRUPPENVERGLEICHE (Durchschnittswerte mit/ohne Merkmal):
${binTable}

Analysiere diese VORBERECHNETEN Zahlen (nicht raten, nur interpretieren was die Zahlen hergeben). Finde die wichtigsten Muster, sei ehrlich über die Grenzen bei dieser Stichprobengröße, unterscheide klar zwischen "auffällig" (|r|>0,3 oder deutlicher Gruppenunterschied) und "kein klares Signal". Erwähne, dass Korrelation nicht Kausalität ist und Trainingslast ein möglicher Störfaktor ist, den diese Analyse nicht herausrechnet.

Der Nutzer will explizit wissen, ob Menge und Verteilung der Makros AB 18 UHR (Kalorien/Protein/Carbs/Fett am Abend) sich auf Schlaf/Recovery auswirken — insbesondere ob komplexe/langkettige und einfache/kurzkettige Kohlenhydrate abends sich unterschiedlich auswirken. Nimm dazu klar Stellung (bestätigt / nicht bestätigt / Daten reichen nicht), auch wenn kein starkes Muster erkennbar ist.

JSON-Format (STRIKT, NUR valides JSON, keine Markdown-Fences, max 5 Muster, max 3 Empfehlungen):
{"zusammenfassung":"3-4 Sätze Gesamtbild","muster":[{"beschreibung":"Was auffällt","staerke":"stark|moderat|schwach","evidenz":"r-Wert oder Gruppenvergleich als Beleg"}],"top_empfehlungen":[{"titel":"Kurz","beschreibung":"1-2 Sätze konkrete Handlung"}]}`

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5', max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!claudeResponse.ok) {
      const errText = await claudeResponse.text()
      throw new Error(`Claude API Fehler ${claudeResponse.status}: ${errText.slice(0, 300)}`)
    }

    const data = await claudeResponse.json()
    const raw = (data.content?.[0]?.text || '').trim()
    if (!raw) throw new Error('Leere Antwort von Claude.')

    const analysis = repairJSON(raw)
    if (!analysis || (!analysis.zusammenfassung && !analysis.muster)) {
      throw new Error('Unerwartete oder nicht parsbare JSON-Struktur von Claude.')
    }

    await updateJob('done', {
      analysis,
      correlations,
      bins,
      coverage: {
        totalPairs: allPairs.length,
        validPairs: validPairs.length,
        excludedPairs: allPairs.length - validPairs.length,
        excludedByReason,
        dateRange: [allPairs[allPairs.length - 1].nutritionDate, allPairs[0].nutritionDate],
      },
    })
    console.log(`correlate-nutrition-sleep BG: job ${jobId} done (${validPairs.length} valide Tage)`)

  } catch (error) {
    console.error('correlate-nutrition-sleep BG Fehler:', error.message)
    if (supabase && jobId) {
      await supabase.from('analysis_jobs').update({
        status: 'error', error: error.message, updated_at: new Date().toISOString(),
      }).eq('id', jobId)
    }
  }
}
