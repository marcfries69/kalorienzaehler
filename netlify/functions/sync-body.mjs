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
  const email    = Netlify.env.get('BLOOD_EMAIL');
  const password = Netlify.env.get('BLOOD_PASSWORD');

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
    'measured_at', 'weight', 'body_fat_pct', 'fat_free_mass',
    'visceral_fat', 'muscle_mass', 'bmi', 'body_water_pct',
    'bmr', 'metabolic_age', 'bone_mass', 'raw_data',
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

  // Deduplicate: per date keep the row with the most non-null body-comp fields
  const countFields = r => ['body_fat_pct','muscle_mass','visceral_fat','fat_free_mass','body_water_pct','bmr']
    .filter(k => r[k] != null).length;
  const byDate = new Map();
  for (const row of rows) {
    const date = (row.measured_at || '').substring(0, 10);
    const existing = byDate.get(date);
    if (!existing || countFields(row) > countFields(existing)) byDate.set(date, row);
  }
  const deduped = [...byDate.values()].sort((a, b) =>
    (a.measured_at || '').localeCompare(b.measured_at || '')
  );

  // ── 3. Map to Kalorienzähler format ────────────────────────────────────────
  // Blood Analytics extra keys vary: German (Fitdays DE) or English depending on app version/row
  const pick = (obj, ...keys) => {
    for (const k of keys) if (obj[k] != null) return obj[k];
    return null;
  };

  const measurements = deduped.map(e => {
    const rd    = e.raw_data || {};
    const extra = rd.extra   || {};

    const fatFreePct = rd.fat_free_mass_pct != null ? +rd.fat_free_mass_pct.toFixed(1)
                     : (e.fat_free_mass != null && e.weight > 0)
                       ? +((e.fat_free_mass / e.weight) * 100).toFixed(1) : null;

    // Try German key first, then English fallback
    const rawMusclePct  = pick(extra, 'skelettmuskulatur_pct', 'skeletal_muscle_pct');
    const rawProtein    = pick(extra, 'proteine_pct',          'protein_pct');
    const rawSubcutFat  = pick(extra, 'unterhautfettgewebe_pct', 'subcutaneous_fat_pct');
    const musclePct     = rawMusclePct != null ? +rawMusclePct.toFixed(1) : null;

    return {
      date:          (e.measured_at || '').substring(0, 10),
      weight:        e.weight        != null ? +e.weight.toFixed(1)        : null,
      fatPct:        e.body_fat_pct  != null ? +e.body_fat_pct.toFixed(1)  : null,
      musclePct,
      fatFreePct,
      muscleMassKg:  e.muscle_mass   != null ? +e.muscle_mass.toFixed(1)   : null,
      fatFreeMassKg: e.fat_free_mass != null ? +e.fat_free_mass.toFixed(1) : null,
      visceralFat:   e.visceral_fat  != null ? +e.visceral_fat.toFixed(1)  : null,
      bmi:           e.bmi           != null ? +e.bmi.toFixed(1)           : null,
      bodyWaterPct:  e.body_water_pct!= null ? +e.body_water_pct.toFixed(1): null,
      boneMassKg:    e.bone_mass     != null ? +e.bone_mass.toFixed(1)     : null,
      bmr:           e.bmr           != null ? Math.round(e.bmr)           : null,
      metabolicAge:  e.metabolic_age,
      skeletalMusclePct: musclePct,
      proteinPct:        rawProtein   != null ? +rawProtein.toFixed(1)   : null,
      subcutFatPct:      rawSubcutFat != null ? +rawSubcutFat.toFixed(1) : null,
      source: 'blood-analytics',
    };
  });

  return Response.json({
    measurements,
    syncedAt: new Date().toISOString(),
    count:    measurements.length,
  });
};
