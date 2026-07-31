// nutrition-sleep-quick.mjs
// Schnelle 30-Tage-Ansicht für den "Ernährung × Schlaf/Recovery"-Tab.
// Holt alles selbst server-seitig: Ernährung direkt aus Supabase, Oura/Whoop
// über die bereits in Blood-Analytics deployten Proxy-Functions (die Tokens
// liegen dort in user_settings, synchronisiert von der Blood-Analytics-App —
// der Kalorienzähler hat keine eigene OAuth-Verbindung). Whoop-Token wird
// NIE selbst refresht: ein Refresh-Token ist bei Whoop einmalig, ein
// unabhängiger Refresh hier würde die Blood-Analytics-Verbindung zerstören.
// Ist der Access-Token abgelaufen, wird Whoop für diesen Lauf einfach
// übersprungen statt zu riskieren, die Kette zu brechen.

import { createClient } from '@supabase/supabase-js'
import { buildDayPairs, computeCorrelations } from './lib/nutritionSleepJoin.mjs'
import { repairJSON } from './lib/repairJSON.mjs'

const SUPABASE_URL = 'https://fwsunbqvkvudmgjkjsbh.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3c3VuYnF2a3Z1ZG1namtqc2JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODY0OTEsImV4cCI6MjA4NzE2MjQ5MX0.5bZOef0bZL4U4eAwthM3JZas_AsjDWgsJwKWjO-RB3I'
const NUTRITION_USER_ID = 'cff2bc0d-5205-4a90-8df9-463afe2065d8'
const BLOOD_ANALYTICS_ORIGIN = 'https://blood-analytics.netlify.app'
const QUICK_WINDOW_DAYS = 35

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
    if (!res.ok) return [] // 401 = abgelaufen -> für diesen Lauf einfach ohne Whoop weitermachen
    return (await res.json()).days || []
  } catch { return [] }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders })
  }

  try {
    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY fehlt')

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

    const [{ data: nutritionRows }, { data: sickRows }, { ouraToken, whoopAccessToken }] = await Promise.all([
      supabase.from('nutrition_log')
        .select('date, total_kcal, protein_g, carbs_g, fat_g, fiber_g, water_ml, caffeine_mg, kcal_goal, meals')
        .eq('user_id', NUTRITION_USER_ID)
        .gte('date', isoDate(Date.now() - QUICK_WINDOW_DAYS * 86400000))
        .order('date', { ascending: false }),
      supabase.from('sick_days').select('date').eq('user_id', NUTRITION_USER_ID),
      loadTokens(supabase),
    ])

    const [ouraDays, whoopDays] = await Promise.all([
      fetchOura(ouraToken, QUICK_WINDOW_DAYS),
      fetchWhoop(whoopAccessToken, QUICK_WINDOW_DAYS),
    ])
    const sickDates = (sickRows || []).map(r => r.date)

    const allPairs = buildDayPairs({ nutritionRows: nutritionRows || [], whoopDays, ouraDays, sickDates })
    const pairs = allPairs.slice(0, 30)
    const validPairs = pairs.filter(p => !p.excluded)
    const correlations = computeCorrelations(validPairs)

    let aiSummary = null
    let aiHints = {}

    if (validPairs.length >= 3) {
      const table = validPairs.map(p => {
        const n = p.nutrition, s = p.sleep
        return `${p.nutritionDate}|kcalΔ:${n.kcalDelta ?? '–'}|Carbs:${n.carbsG ?? '–'}g|Ballast:${n.fiberG ?? '–'}g|` +
          `späteCarbs:${n.lateCarbsG ?? '–'}g|letzteMahlzeit:${n.lastMealTime ?? '–'}|` +
          `Koffein:${n.caffeineMg ?? '–'}mg|KoffeinNach14Uhr:${n.lateCaffeineMg ?? '–'}mg|` +
          `AbendKcal:${n.eveningKcal ?? '–'}|AbendProtein:${n.eveningProteinG ?? '–'}g|AbendCarbsKomplex:${n.eveningCarbsComplexG ?? '–'}g|AbendCarbsEinfach:${n.eveningCarbsSimpleG ?? '–'}g|AbendFett:${n.eveningFatG ?? '–'}g|→` +
          `HRV:${s?.hrv ?? '–'}|Recovery:${s?.recoveryScore ?? '–'}|SleepEff:${s?.sleepEfficiency ?? '–'}|RHR:${s?.rhr ?? '–'}`
      }).join('\n')

      const prompt = `Du bist Ernährungs-/Schlafcoach. Hier sind ${validPairs.length} Tage: Ernährung an Tag D, Schlaf/Recovery am Folgetag D+1 (Whoop/Oura).

FORMAT: Datum|kcalΔ (Über-/Unterschuss zum Ziel)|Kohlenhydrate|Ballaststoffe|Kohlenhydrate nach 20 Uhr|Uhrzeit letzte Mahlzeit|Koffein gesamt|Koffein nach 14 Uhr|Kalorien ab 18 Uhr|Protein ab 18 Uhr|Kohlenhydrate komplex/langkettig ab 18 Uhr|Kohlenhydrate einfach/kurzkettig ab 18 Uhr|Fett ab 18 Uhr|→|HRV|Recovery-Score|Sleep Efficiency|Ruhepuls

${table}

Der Nutzer will explizit wissen, ob Menge und Verteilung der Makros AB 18 UHR sich auf Schlaf/Recovery auswirken — insbesondere ob einfache/kurzkettige Kohlenhydrate abends (schneller Blutzuckeranstieg) sich anders auswirken als komplexe/langkettige. Geh in der Gesamteinschätzung gezielt darauf ein, auch wenn kein starkes Muster erkennbar ist.

Gib für jeden Tag, an dem etwas auffällt (nicht für unauffällige Tage), einen SEHR kurzen Hinweis (max 12 Wörter). Plus eine 2-3-Satz-Gesamteinschätzung über erste Muster, die du in diesen ${validPairs.length} Tagen siehst. Das ist eine ERSTE Einschätzung auf kleiner Stichprobe, keine gesicherte Aussage — formuliere entsprechend vorsichtig.

JSON-Format (STRIKT, NUR valides JSON, keine Markdown-Fences):
{"zusammenfassung":"2-3 Sätze","hinweise":{"YYYY-MM-DD":"kurzer Hinweis", ...nur auffällige Tage...}}`

      const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5', max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        }),
      })

      if (claudeResponse.ok) {
        const data = await claudeResponse.json()
        const raw = (data.content?.[0]?.text || '').trim()
        const parsed = repairJSON(raw)
        if (parsed) {
          aiSummary = parsed.zusammenfassung || null
          aiHints = parsed.hinweise || {}
        }
      }
    }

    return Response.json({
      success: true,
      pairs,
      validCount: validPairs.length,
      excludedCount: pairs.length - validPairs.length,
      ouraConnected: !!ouraToken,
      whoopConnected: !!whoopAccessToken,
      correlations,
      aiSummary,
      aiHints,
    }, { headers: corsHeaders })
  } catch (error) {
    console.error('nutrition-sleep-quick error:', error.message)
    return Response.json({ error: error.message }, { status: 500, headers: corsHeaders })
  }
}
