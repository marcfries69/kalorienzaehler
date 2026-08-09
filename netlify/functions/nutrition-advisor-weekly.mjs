// nutrition-advisor-weekly.mjs
// Netlify Scheduled Function: läuft automatisch jeden Montag um 06:00 UTC
// (07:00/08:00 MEZ/MESZ) und aktualisiert die Ernährungsberater-Bewertung im
// "Berater"-Tab, ohne dass ein manueller Klick nötig ist. Nutzt dieselbe
// Kernlogik wie der manuelle Trigger (nutrition-advisor-background.mjs),
// schreibt aber nur nach nutrition_advisor_results — niemand pollt live auf
// analysis_jobs, da hier kein Client wartet.

import { createClient } from '@supabase/supabase-js'
import { runNutritionAdvisor } from './lib/nutritionAdvisor.mjs'

const SUPABASE_URL = 'https://fwsunbqvkvudmgjkjsbh.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3c3VuYnF2a3Z1ZG1namtqc2JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODY0OTEsImV4cCI6MjA4NzE2MjQ5MX0.5bZOef0bZL4U4eAwthM3JZas_AsjDWgsJwKWjO-RB3I'
const NUTRITION_USER_ID = 'cff2bc0d-5205-4a90-8df9-463afe2065d8'

export default async () => {
  try {
    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY fehlt')

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    const result = await runNutritionAdvisor(supabase, apiKey)

    await supabase.from('nutrition_advisor_results').upsert({
      user_id: NUTRITION_USER_ID, result, trigger: 'weekly', generated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

    console.log('nutrition-advisor-weekly: Bewertung aktualisiert')
  } catch (error) {
    console.error('nutrition-advisor-weekly Fehler:', error.message)
  }
}

export const config = {
  schedule: '0 6 * * 1',
}
