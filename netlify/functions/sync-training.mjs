/**
 * sync-training.mjs
 * Fetches last 30 days of Strava activities via admin refresh token.
 * Estimates calories from HR/duration when Strava doesn't report them.
 * Required Netlify env vars: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_ADMIN_REFRESH_TOKEN
 */

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API       = 'https://www.strava.com/api/v3';

async function refreshAccessToken() {
  const body = {
    client_id:     Netlify.env.get('STRAVA_CLIENT_ID'),
    client_secret: Netlify.env.get('STRAVA_CLIENT_SECRET'),
    refresh_token: Netlify.env.get('STRAVA_ADMIN_REFRESH_TOKEN'),
    grant_type:    'refresh_token',
  };

  const res = await fetch(STRAVA_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Strava Token-Refresh fehlgeschlagen (${res.status}): ${data.message || JSON.stringify(data)}`);
  }
  if (!data.access_token) {
    throw new Error(`Kein access_token in Strava-Antwort: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

/**
 * Estimate calories burned when Strava doesn't report them.
 * Uses MET-based estimation: kcal = MET × weight(kg) × hours
 * Weight fallback: 75 kg (typical for this user)
 */
function estimateCalories(activity, weightKg = 75) {
  const mins = Math.round((activity.moving_time || 0) / 60);
  if (mins < 5) return 0;

  const type = (activity.type || activity.sport_type || '').toLowerCase();
  const avgHR = activity.average_heartrate || 0;
  const avgW  = activity.weighted_average_watts || activity.average_watts || 0;

  // Walk/Hike: immer MET (HR-Formel überschätzt bei niedrig-intensivem Gehen stark)
  if (type.includes('walk') || type.includes('hike')) {
    const met = type.includes('hike') ? 5.3 : 3.5;
    return Math.round(met * weightKg * (mins / 60));
  }

  // Krafttraining ohne HR-Daten: Pauschale 200 kcal
  if (type.includes('weight') || type.includes('strength')) return 200;

  // Power-based (cycling) — most accurate
  if (avgW > 0 && (type.includes('ride') || type.includes('cycling') || type.includes('virtual'))) {
    return Math.round(avgW * (mins / 60) * 3.6); // watts × hours × 3.6
  }

  // HR-based estimation (nur für Cardio mit erhöhtem Puls)
  // Formula: kcal/min = (−55.0969 + 0.6309×HR + 0.1988×weight + 0.2017×age) / 4.184 (male)
  if (avgHR > 80) {
    const age = 57;
    const kcalPerMin = (-55.0969 + 0.6309 * avgHR + 0.1988 * weightKg + 0.2017 * age) / 4.184;
    return Math.max(0, Math.round(kcalPerMin * mins));
  }

  // MET fallback
  let met = 5; // default moderate
  if (type.includes('run'))               met = 9.8;
  else if (type.includes('ride') || type.includes('cycling')) met = 7.5;
  else if (type.includes('swim'))         met = 8.0;
  else if (type.includes('yoga'))         met = 3.0;
  else if (type.includes('crossfit') || type.includes('hiit')) met = 8.0;
  else if (type.includes('row'))          met = 8.5;

  return Math.round(met * weightKg * (mins / 60));
}

// Strava-Kalorien (gemeldet wie geschätzt) sind im Schnitt zu hoch angesetzt.
// Pauschale Korrektur von -25% auf alle Werte, bevor weitere Anteil-Regeln greifen.
const STRAVA_DEFLATION = 0.75;

function activityCategory(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('weight') || t.includes('strength') || t.includes('crossfit')) return 'strength';
  if (t.includes('run') || t.includes('hike') || t.includes('walk'))  return 'cardio';
  if (t.includes('ride') || t.includes('cycling') || t.includes('bike') || t.includes('virtual')) return 'cardio';
  if (t.includes('swim')) return 'cardio';
  if (t.includes('yoga') || t.includes('stretch') || t.includes('pilates')) return 'mobility';
  if (t.includes('hiit') || t.includes('circuit')) return 'strength';
  return 'other';
}

export default async (req) => {
  try {
    const missing = ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'STRAVA_ADMIN_REFRESH_TOKEN']
      .filter(k => !Netlify.env.get(k));
    if (missing.length) {
      return Response.json(
        { error: `Fehlende Netlify Env Vars: ${missing.join(', ')}` },
        { status: 500 }
      );
    }

    // ── 1. Get fresh Strava access token ──────────────────────────────────────
    const accessToken = await refreshAccessToken();

    // ── 2. Fetch last 30 days of activities ───────────────────────────────────
    const after  = Math.floor((Date.now() - 30 * 86400 * 1000) / 1000);
    const before = Math.floor(Date.now() / 1000);

    const activitiesRes = await fetch(
      `${STRAVA_API}/athlete/activities?per_page=100&after=${after}&before=${before}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!activitiesRes.ok) {
      const errText = await activitiesRes.text();
      throw new Error(`Strava Activities API (${activitiesRes.status}): ${errText.slice(0, 300)}`);
    }

    const raw = await activitiesRes.json();
    if (!Array.isArray(raw)) {
      throw new Error(`Unerwartetes Strava-Format: ${JSON.stringify(raw).slice(0, 200)}`);
    }

    // ── 3. Aggregate per calendar day ─────────────────────────────────────────
    const byDay = {};

    for (const a of raw) {
      const dateKey = (a.start_date_local || a.start_date || '').slice(0, 10);
      if (!dateKey) continue;

      if (!byDay[dateKey]) {
        byDay[dateKey] = {
          date:          dateKey,
          activities:    [],
          totalCalories: 0,
          totalMinutes:  0,
          types:         [],
        };
      }

      const mins     = Math.round((a.moving_time || 0) / 60);
      const type     = a.type || a.sport_type || '';
      const cat      = activityCategory(type);

      // Use Strava calories if available, otherwise estimate
      const reportedCal = a.calories || 0;
      const rawCalories = reportedCal > 10 ? reportedCal : estimateCalories(a);

      // Anteil-Regeln:
      const typeLow    = type.toLowerCase();
      const nameLow    = (a.name || '').toLowerCase();
      const isWalkHike = typeLow.includes('walk') || typeLow.includes('hike');
      const isRide     = typeLow.includes('ride') || typeLow.includes('cycling') || typeLow.includes('virtual');
      const isRun      = typeLow.includes('run');
      const isVo2max   = /vo2|intervall|interval|hiit/i.test(nameLow);
      // Kurze Zone-2-Einheiten (Rad/Lauf, kein VO2max, < 90 min) → 75%
      // Alles ≥ 90 min oder VO2max → 100%
      const isShortZone2 = (isRide || isRun) && !isVo2max && mins < 90;

      let caloriesFactor = 1.0;
      let caloriesSource = reportedCal > 10 ? 'strava' : 'estimated';
      if (isWalkHike) {
        caloriesFactor = 0.5;
        caloriesSource = reportedCal > 10 ? 'strava_50pct' : 'estimated_50pct';
      } else if (isShortZone2) {
        caloriesFactor = 0.75;
        caloriesSource = reportedCal > 10 ? 'strava_75pct' : 'estimated_75pct';
      }
      const calories = Math.round(rawCalories * caloriesFactor * STRAVA_DEFLATION);

      // Deduplizierung: gleicher Name + ähnliche Dauer (±10 min) → Duplikat überspringen
      // (passiert wenn Strava-App + Watch dieselbe Einheit aufzeichnen)
      const isDuplicate = byDay[dateKey].activities.some(existing => {
        const sameName = existing.name?.toLowerCase().trim() === (a.name || '').toLowerCase().trim();
        const similarDuration = Math.abs((existing.minutes || 0) - mins) <= 10;
        return sameName && similarDuration;
      });
      if (isDuplicate) continue;

      byDay[dateKey].activities.push({
        name:           a.name,
        type,
        category:       cat,
        minutes:        mins,
        calories,
        caloriesSource,
        avgHR:          a.average_heartrate || null,
        avgWatts:       a.weighted_average_watts || a.average_watts || null,
        distance:       a.distance ? +(a.distance / 1000).toFixed(2) : null,
        elevation:      a.total_elevation_gain || null,
      });

      byDay[dateKey].totalCalories += calories;
      byDay[dateKey].totalMinutes  += mins;
      if (!byDay[dateKey].types.includes(cat)) byDay[dateKey].types.push(cat);
    }

    const days = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));

    return Response.json({
      days,
      syncedAt:   new Date().toISOString(),
      totalDays:  days.length,
      totalActivities: raw.length,
    });

  } catch (err) {
    console.error('sync-training error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
};
