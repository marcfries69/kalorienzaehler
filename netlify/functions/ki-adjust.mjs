/**
 * ki-adjust.mjs
 * KI-Intelligenz: Analysiert Körperdaten + Ernährung + Bewegung
 * und berechnet optimale Kalorien- und Makroziele für Fettabbau
 * bei gleichzeitigem Muskelerhalt/-aufbau.
 *
 * POST body: { bodyMeasurements, bodyGoals, nutritionHistory, trainingDays, currentGoal, macroGoals }
 * Returns: { kcalGoal, macros, warnings, explanation, adjustmentReason }
 */

export default async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  try {
    const apiKey = process.env.GOOGLE_API_KEY || Netlify.env.get?.('GOOGLE_API_KEY');
    if (!apiKey) return Response.json({ error: 'GOOGLE_API_KEY fehlt' }, { status: 500 });

    const { bodyMeasurements = [], bodyGoals = {}, nutritionHistory = [], trainingDays = [], currentKcalGoal, macroGoals } = await req.json();

    // ── Build analysis context ──────────────────────────────────────────────

    // Last 2 body measurements for trend
    const sorted = [...bodyMeasurements].sort((a, b) => a.date.localeCompare(b.date));
    const latest  = sorted[sorted.length - 1] || null;
    const prev    = sorted[sorted.length - 2] || null;

    const weightTrend = (latest && prev && latest.weight && prev.weight)
      ? +(latest.weight - prev.weight).toFixed(2) : null;
    const fatTrend = (latest && prev && latest.fatPct && prev.fatPct)
      ? +(latest.fatPct - prev.fatPct).toFixed(2) : null;
    const muscleTrend = (latest && prev && latest.musclePct && prev.musclePct)
      ? +(latest.musclePct - prev.musclePct).toFixed(2) : null;

    // Average nutrition over last 14 days
    const recent14 = nutritionHistory.slice(-14);
    const avgKcal = recent14.length
      ? Math.round(recent14.reduce((s, d) => s + (d.kcal || 0), 0) / recent14.length) : null;
    const avgProtein = recent14.length
      ? Math.round(recent14.reduce((s, d) => s + (d.protein || 0), 0) / recent14.length) : null;

    // Training load last 7 days
    const last7Days = trainingDays.filter(d => {
      const diff = (Date.now() - new Date(d.date + 'T12:00:00').getTime()) / 86400000;
      return diff <= 7;
    });
    const avgBurnPerActiveDay = last7Days.length
      ? Math.round(last7Days.reduce((s, d) => s + (d.totalCalories || 0), 0) / last7Days.length) : 0;
    const activeDaysLast7 = last7Days.length;
    const hasStrengthTraining = last7Days.some(d => d.types?.includes('strength'));

    // Build prompt
    const prompt = `Du bist ein Ernährungs- und Body-Recomposition-Experte. Analysiere die folgenden Daten und gib AUSSCHLIESSLICH eine JSON-Antwort zurück.

## AKTUELLE KÖRPERDATEN
${latest ? `- Datum: ${latest.date}
- Gewicht: ${latest.weight ?? '–'} kg
- Körperfettanteil: ${latest.fatPct ?? '–'} %
- Fettfreie Masse/Muskeln: ${latest.musclePct ?? '–'} %
- Muskelmasse: ${latest.muscleMassKg ?? '–'} kg
- Viszerales Fett: ${latest.visceralFat ?? '–'}
- BMI: ${latest.bmi ?? '–'}` : 'Keine Körperdaten vorhanden'}

## KÖRPER-TREND (letzte 2 Messungen)
- Gewichtsveränderung: ${weightTrend !== null ? `${weightTrend > 0 ? '+' : ''}${weightTrend} kg` : 'unbekannt'}
- Fettanteil-Veränderung: ${fatTrend !== null ? `${fatTrend > 0 ? '+' : ''}${fatTrend}%` : 'unbekannt'}
- Muskel-Veränderung: ${muscleTrend !== null ? `${muscleTrend > 0 ? '+' : ''}${muscleTrend}%` : 'unbekannt'}

## ZIELWERTE
- Zielgewicht: ${bodyGoals.weight ?? '–'} kg
- Ziel-Fettanteil: ${bodyGoals.fatPct ?? '–'} %
- Ziel-Muskelmasse: ${bodyGoals.musclePct ?? '–'} %
- Ziel-Viszerales Fett: ${bodyGoals.visceralFat ?? '–'}

## ERNÄHRUNG (Ø letzte 14 Tage)
- Ø Kalorien: ${avgKcal ?? '–'} kcal/Tag
- Ø Protein: ${avgProtein ?? '–'} g/Tag
- Aktuelles Kalorienziel: ${currentKcalGoal ?? '–'} kcal

## BEWEGUNGSDATEN (letzte 7 Tage)
- Aktive Tage: ${activeDaysLast7} von 7
- Ø Kalorienverbrauch pro Trainingstag: ${avgBurnPerActiveDay > 0 ? avgBurnPerActiveDay + ' kcal' : 'keine Daten'}
- Krafttraining vorhanden: ${hasStrengthTraining ? 'Ja' : 'Nein'}
${last7Days.length > 0 ? '- Trainingstage: ' + last7Days.map(d => `${d.date} (${d.totalMinutes}min, ${d.totalCalories}kcal, ${d.types?.join('+')})`).join(' | ') : ''}

## AUFTRAG
Berechne optimale Kalorien- und Makroziele für Rekomposition (Fettabbau + Muskelerhalt/-aufbau).

Grundregeln:
1. Kaloriendefizit: 300-400 kcal unter TDEE (nie mehr als 500 kcal Defizit)
2. Protein: MINIMUM 2.0g pro kg Körpergewicht (bis 2.4g bei aktivem Krafttraining) um Muskelabbau zu verhindern
3. Wenn Muskeln verloren gehen (muscleTrend < -0.5%) → Defizit reduzieren auf max. 200 kcal + Proteinwarnung
4. Wenn zu schnell abgenommen wird (weightTrend < -1.5 kg/Woche) → Defizit reduzieren
5. Wenn Fettanteil gestiegen → Defizit erhöhen (max. 400 kcal)
6. An Trainingstagen +100-200 kcal extra erlaubt
7. Kohlenhydrate: primär um Training herum
8. Fett: mindestens 0.8g/kg für Hormonbalance

Antworte NUR mit diesem JSON (kein Markdown, kein Text davor oder danach):
{
  "kcalGoal": <Zahl>,
  "macros": {
    "proteinPct": <Zahl>,
    "carbsPct": <Zahl>,
    "fatPct": <Zahl>,
    "fiberG": <Zahl>
  },
  "warnings": [<string>, ...],
  "adjustmentReason": "<kurze deutsche Begründung, max 2 Sätze>",
  "weeklyDeficit": <Zahl in kcal>,
  "estimatedWeeksToGoal": <Zahl oder null>,
  "trainDayBonus": <Zahl in kcal, 0 wenn kein Training>
}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );

    if (!geminiRes.ok) throw new Error(`Gemini API ${geminiRes.status}`);

    const geminiData = await geminiRes.json();
    const raw = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Extract JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('KI hat kein gültiges JSON zurückgegeben');

    const result = JSON.parse(jsonMatch[0]);

    // Sanity checks
    if (!result.kcalGoal || result.kcalGoal < 1200 || result.kcalGoal > 5000) {
      throw new Error(`Ungültiger kcalGoal-Wert: ${result.kcalGoal}`);
    }

    return Response.json({ ...result, analyzedAt: new Date().toISOString() });

  } catch (err) {
    console.error('ki-adjust error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
};
