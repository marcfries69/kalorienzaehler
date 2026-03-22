/**
 * sync-training.mjs
 * Fetches the last 30 days of Strava activities and returns per-day summaries
 * for use in the KI-Intelligenz calorie adjustment.
 */

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API       = 'https://www.strava.com/api/v3';

async function getAccessToken() {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      client_id:     process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: process.env.STRAVA_ADMIN_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh fehlgeschlagen: ${res.status}`);
  const d = await res.json();
  return d.access_token;
}

function toDateKey(dateStr) {
  return (dateStr || '').slice(0, 10);
}

// Approximate TDEE adjustment from activity
function activityCategory(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('weight') || t.includes('strength')) return 'strength';
  if (t.includes('run') || t.includes('hike') || t.includes('walk')) return 'cardio';
  if (t.includes('ride') || t.includes('cycling') || t.includes('bike')) return 'cardio';
  if (t.includes('swim')) return 'cardio';
  if (t.includes('yoga') || t.includes('stretch')) return 'mobility';
  return 'other';
}

export default async (req) => {
  try {
    const missing = ['STRAVA_CLIENT_ID','STRAVA_CLIENT_SECRET','STRAVA_ADMIN_REFRESH_TOKEN']
      .filter(k => !process.env[k]);
    if (missing.length) {
      return Response.json({ error: `Fehlende Env Vars: ${missing.join(', ')}` }, { status: 500 });
    }

    const accessToken = await getAccessToken();

    // Last 30 days
    const after  = Math.floor((Date.now() - 30 * 86400 * 1000) / 1000);
    const before = Math.floor(Date.now() / 1000);

    const res = await fetch(
      `${STRAVA_API}/athlete/activities?per_page=100&after=${after}&before=${before}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) throw new Error(`Strava API ${res.status}`);

    const raw = await res.json();

    // Aggregate per calendar day
    const byDay = {};
    for (const a of raw) {
      const key = toDateKey(a.start_date_local || a.start_date);
      if (!byDay[key]) byDay[key] = { date: key, activities: [], totalCalories: 0, totalMinutes: 0, types: [] };

      const cal  = a.calories || 0;
      const mins = Math.round((a.moving_time || 0) / 60);
      const type = a.type || a.sport_type || '';
      const cat  = activityCategory(type);

      byDay[key].activities.push({
        name:        a.name,
        type,
        category:    cat,
        minutes:     mins,
        calories:    cal,
        avgHR:       a.average_heartrate || null,
        avgWatts:    a.weighted_average_watts || a.average_watts || null,
        distance:    a.distance ? +(a.distance / 1000).toFixed(2) : null, // km
        elevation:   a.total_elevation_gain || null,
      });

      byDay[key].totalCalories += cal;
      byDay[key].totalMinutes  += mins;
      if (!byDay[key].types.includes(cat)) byDay[key].types.push(cat);
    }

    const days = Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date));

    return Response.json({
      days,
      syncedAt:    new Date().toISOString(),
      totalDays:   days.length,
    });

  } catch (err) {
    console.error('sync-training error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
};
