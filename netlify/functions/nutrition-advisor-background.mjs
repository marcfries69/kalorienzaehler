// nutrition-advisor-background.mjs
// Manueller Trigger für den Ernährungsberater ("Berater"-Tab). Background-
// Function (kein Response an den Client), aktualisiert analysis_jobs für das
// Live-Polling im Client UND schreibt das Ergebnis zusätzlich in die eigene
// Tabelle nutrition_advisor_results (nicht user_settings — dort liegen die
// Whoop/Oura-Tokens, die keine zusätzliche Schreibfläche bekommen sollen),
// damit der Tab beim nächsten Öffnen sofort den letzten Stand zeigen kann —
// unabhängig davon, ob der Lauf manuell oder durch den wöchentlichen
// Scheduled-Trigger kam.

import { createClient } from '@supabase/supabase-js'
import { runNutritionAdvisor } from './lib/nutritionAdvisor.mjs'

const SUPABASE_URL = 'https://fwsunbqvkvudmgjkjsbh.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3c3VuYnF2a3Z1ZG1namtqc2JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODY0OTEsImV4cCI6MjA4NzE2MjQ5MX0.5bZOef0bZL4U4eAwthM3JZas_AsjDWgsJwKWjO-RB3I'
const NUTRITION_USER_ID = 'cff2bc0d-5205-4a90-8df9-463afe2065d8'

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

    const result = await runNutritionAdvisor(supabase, apiKey)

    await updateJob('done', result)

    await supabase.from('nutrition_advisor_results').upsert({
      user_id: NUTRITION_USER_ID, result, trigger: 'manual', generated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

    console.log(`nutrition-advisor BG: job ${jobId} done`)

  } catch (error) {
    console.error('nutrition-advisor BG Fehler:', error.message)
    if (supabase && jobId) {
      await supabase.from('analysis_jobs').update({
        status: 'error', error: error.message, updated_at: new Date().toISOString(),
      }).eq('id', jobId)
    }
  }
}
