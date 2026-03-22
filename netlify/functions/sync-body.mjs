/**
 * sync-body.mjs
 * Fetches body composition data from Blood Analytics (Supabase)
 * and returns it in Kalorienzähler format.
 *
 * Required Netlify env vars:
 *   BLOOD_EMAIL    – Blood Analytics account email
 *   BLOOD_PASSWORD – Blood Analytics account password
 */

const SUPABASE_URL     = 'https://fwsunbqvkvudmgjkjsbh.supabase.co';
const SUPABASE_ANON    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3c3VuYnF2a3Z1ZG1namtqc2JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODY0OTEsImV4cCI6MjA4NzE2MjQ5MX0.5bZOef0bZL4U4eAwthM3JZas_AsjDWgsJwKWjO-RB3I';

export default async (req) => {
  const email    = process.env.BLOOD_EMAIL;
  const password = process.env.BLOOD_PASSWORD;

  if (!email || !password) {
    return Response.json(
      { error: 'BLOOD_EMAIL / BLOOD_PASSWORD nicht konfiguriert (Netlify Env Vars).' },
      { status: 500 }
    );
  }

  // ── 1. Sign in ──────────────────────────────────────────────────────────────
  const authRes = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON,
      },
      body: JSON.stringify({ email, password }),
    }
  );

  if (!authRes.ok) {
    const err = await authRes.json().catch(() => ({}));
    return Response.json(
      { error: `Auth fehlgeschlagen: ${err.error_description || authRes.status}` },
      { status: 401 }
    );
  }

  const { access_token } = await authRes.json();

  // ── 2. Fetch body_composition ───────────────────────────────────────────────
  const cols = [
    'measured_at', 'weight', 'body_fat_pct', 'fat_free_pct',
    'visceral_fat', 'muscle_mass_calc', 'bmi', 'body_water_pct',
    'bmr', 'metabolic_age',
  ].join(',');

  const dataRes = await fetch(
    `${SUPABASE_URL}/rest/v1/body_composition?select=${cols}&order=measured_at.asc`,
    {
      headers: {
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${access_token}`,
        Accept: 'application/json',
      },
    }
  );

  if (!dataRes.ok) {
    const err = await dataRes.json().catch(() => ({}));
    return Response.json(
      { error: `Datenabruf fehlgeschlagen: ${err.message || dataRes.status}` },
      { status: 502 }
    );
  }

  const rows = await dataRes.json();

  // ── 3. Map to Kalorienzähler format ────────────────────────────────────────
  const measurements = rows.map(e => ({
    date:        (e.measured_at || '').substring(0, 10),
    weight:      e.weight       != null ? +e.weight.toFixed(1)       : null,
    fatPct:      e.body_fat_pct != null ? +e.body_fat_pct.toFixed(1) : null,
    musclePct:   e.fat_free_pct != null ? +e.fat_free_pct.toFixed(1) : null,  // fat-free mass %
    muscleMassKg:e.muscle_mass_calc != null ? +e.muscle_mass_calc.toFixed(1) : null,
    visceralFat: e.visceral_fat != null ? +e.visceral_fat.toFixed(1) : null,
    bmi:         e.bmi          != null ? +e.bmi.toFixed(1)          : null,
    bodyWaterPct:e.body_water_pct != null ? +e.body_water_pct.toFixed(1) : null,
    bmr:         e.bmr          != null ? Math.round(e.bmr)          : null,
    metabolicAge:e.metabolic_age,
    source:      'blood-analytics',
  }));

  return Response.json({
    measurements,
    syncedAt: new Date().toISOString(),
    count:    measurements.length,
  });
};
