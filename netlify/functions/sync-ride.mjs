/**
 * sync-ride.mjs
 * Holt die zuletzt absolvierte Rad-Einheit von Strava inkl. tatsächlicher
 * Zonenverteilung (Power- oder HR-Zonen) und rekonstruiert daraus die Blöcke
 * für den Recovery-Plan.
 *
 * GET → { found, activity, blocks, zoneSource }
 * Required env: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_ADMIN_REFRESH_TOKEN
 */

const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API       = 'https://www.strava.com/api/v3';

async function refreshAccessToken() {
  const res = await fetch(STRAVA_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      client_id:     Netlify.env.get('STRAVA_CLIENT_ID'),
      client_secret: Netlify.env.get('STRAVA_CLIENT_SECRET'),
      refresh_token: Netlify.env.get('STRAVA_ADMIN_REFRESH_TOKEN'),
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Strava Token-Refresh fehlgeschlagen (${res.status}): ${data.message || JSON.stringify(data)}`);
  }
  return data.access_token;
}

// Strava-Kalorien sind im Schnitt zu hoch angesetzt – pauschale Korrektur.
const STRAVA_DEFLATION = 0.75;

const isRideType = (t) => {
  const s = (t || '').toLowerCase();
  return s.includes('ride') || s.includes('cycling') || s.includes('virtual');
};

/**
 * Mappt Strava-Zonen-Buckets auf unser Z1–Z6 Modell.
 * Power: 7 Coggan-Zonen → Z6 fasst anaerob+neuromuskulär zusammen.
 * HR: meist 5 Zonen → direkt Z1–Z5.
 */
function bucketsToBlocks(buckets, type) {
  if (!Array.isArray(buckets) || buckets.length === 0) return [];

  // Index → unsere Zone
  let zoneMap;
  if (type === 'power') {
    if (buckets.length >= 7)      zoneMap = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6', 'Z6'];
    else if (buckets.length === 6) zoneMap = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6'];
    else                           zoneMap = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
  } else {
    // heartrate – meist 5 Zonen
    if (buckets.length >= 6)      zoneMap = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6'];
    else                          zoneMap = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
  }

  const minutesByZone = {};
  buckets.forEach((b, i) => {
    const zone = zoneMap[i] || zoneMap[zoneMap.length - 1];
    const mins = Math.round((b.time || 0) / 60);
    if (mins > 0) minutesByZone[zone] = (minutesByZone[zone] || 0) + mins;
  });

  const order = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6'];
  return order
    .filter(z => minutesByZone[z] > 0)
    .map(z => ({ zone: z, minutes: minutesByZone[z] }));
}

/** Fallback: Intensität aus avg-Watts/FTP oder avg-HR schätzen. */
function estimateBlock(activity) {
  const mins  = Math.round((activity.moving_time || 0) / 60);
  if (mins < 1) return [];
  const avgHR = activity.average_heartrate || 0;
  // Grobe HR-basierte Schätzung (max-HR-Annahme ~175)
  let zone = 'Z2';
  if (avgHR > 0) {
    if (avgHR < 115)      zone = 'Z1';
    else if (avgHR < 140) zone = 'Z2';
    else if (avgHR < 155) zone = 'Z3';
    else if (avgHR < 168) zone = 'Z4';
    else                  zone = 'Z5';
  }
  return [{ zone, minutes: mins }];
}

export default async () => {
  try {
    const missing = ['STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET', 'STRAVA_ADMIN_REFRESH_TOKEN']
      .filter(k => !Netlify.env.get(k));
    if (missing.length) {
      return Response.json({ error: `Fehlende Env Vars: ${missing.join(', ')}` }, { status: 500 });
    }

    const accessToken = await refreshAccessToken();

    // Letzte 7 Tage Aktivitäten holen, jüngste Rad-Einheit suchen
    const after = Math.floor((Date.now() - 7 * 86400 * 1000) / 1000);
    const listRes = await fetch(
      `${STRAVA_API}/athlete/activities?per_page=30&after=${after}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!listRes.ok) {
      const t = await listRes.text();
      throw new Error(`Strava Activities API (${listRes.status}): ${t.slice(0, 200)}`);
    }
    const list = await listRes.json();
    if (!Array.isArray(list)) throw new Error('Unerwartetes Strava-Format');

    const rides = list
      .filter(a => isRideType(a.type || a.sport_type))
      .sort((a, b) => new Date(b.start_date).getTime() - new Date(a.start_date).getTime());

    if (rides.length === 0) {
      return Response.json({ found: false, message: 'Keine Rad-Einheit in den letzten 7 Tagen gefunden.' });
    }

    const ride = rides[0];

    // Zonenverteilung der Einheit holen
    let blocks = [];
    let zoneSource = 'estimated';
    try {
      const zonesRes = await fetch(`${STRAVA_API}/activities/${ride.id}/zones`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (zonesRes.ok) {
        const zonesData = await zonesRes.json();
        // Power bevorzugen (genauer), sonst HR
        const power = Array.isArray(zonesData) ? zonesData.find(z => z.type === 'power') : null;
        const hr    = Array.isArray(zonesData) ? zonesData.find(z => z.type === 'heartrate') : null;
        if (power?.distribution_buckets?.some(b => b.time > 0)) {
          blocks = bucketsToBlocks(power.distribution_buckets, 'power');
          zoneSource = 'power';
        } else if (hr?.distribution_buckets?.some(b => b.time > 0)) {
          blocks = bucketsToBlocks(hr.distribution_buckets, 'heartrate');
          zoneSource = 'heartrate';
        }
      }
    } catch { /* zones optional – fällt auf Schätzung zurück */ }

    if (blocks.length === 0) {
      blocks = estimateBlock(ride);
      zoneSource = 'estimated';
    }

    const movingMinutes = Math.round((ride.moving_time || 0) / 60);

    return Response.json({
      found: true,
      activity: {
        id:            ride.id,
        name:          ride.name,
        date:          (ride.start_date_local || ride.start_date || '').slice(0, 10),
        startTime:     ride.start_date_local || ride.start_date,
        movingMinutes,
        calories:      ride.calories ? Math.round(ride.calories * STRAVA_DEFLATION) : null,
        avgHR:         ride.average_heartrate || null,
        maxHR:         ride.max_heartrate || null,
        avgWatts:      ride.weighted_average_watts || ride.average_watts || null,
        distanceKm:    ride.distance ? +(ride.distance / 1000).toFixed(1) : null,
        elevationM:    ride.total_elevation_gain || null,
      },
      blocks,
      zoneSource,
      syncedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('sync-ride error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
};
