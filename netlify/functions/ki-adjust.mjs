/**
 * ki-adjust.mjs – KI-Intelligenz Kalorienoptimierung
 *
 * Kalorienberechnung: deterministisch (server-side, Mifflin-St Jeor)
 * Gemini: nur Makros, Warnungen, Begründung
 *
 * POST { bodyMeasurements, bodyGoals, nutritionHistory, trainingDays,
 *         currentKcalGoal, macroGoals, userProfile }
 * → { kcalGoal (=RestDay), kcalGoalRestDay, kcalGoalTrainDay,
 *     tdeeUsed, tdeeRestDay, deficitApplied,
 *     macros, warnings, adjustmentReason,
 *     weeklyDeficit, estimatedWeeksToGoal, trainDayBonus, redSRisk }
 */

export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY fehlt' }, { status: 500 });

    const {
      bodyMeasurements = [],
      bodyGoals        = {},
      nutritionHistory = [],
      trainingDays     = [],
      currentKcalGoal,
      macroGoals,
      userProfile      = {},
    } = await req.json();

    // ── 1. Body trend ────────────────────────────────────────────────────────
    const sorted  = [...bodyMeasurements].sort((a, b) => a.date.localeCompare(b.date));
    const latest  = sorted[sorted.length - 1] || null;
    const prev    = sorted[sorted.length - 2] || null;
    const prev3   = sorted[sorted.length - 3] || null;

    const weightTrend  = (latest?.weight && prev?.weight)
      ? +(latest.weight - prev.weight).toFixed(2) : null;
    const fatTrend     = (latest?.fatPct && prev?.fatPct)
      ? +(latest.fatPct - prev.fatPct).toFixed(2) : null;
    const muscleTrend  = (latest?.musclePct && prev?.musclePct)
      ? +(latest.musclePct - prev.musclePct).toFixed(2) : null;
    const visceralTrend = (latest?.visceralFat != null && prev?.visceralFat != null)
      ? +(latest.visceralFat - prev.visceralFat).toFixed(1) : null;

    const weightTrend3 = (latest?.weight && prev3?.weight)
      ? +(latest.weight - prev3.weight).toFixed(2) : null;
    const muscleTrend3 = (latest?.musclePct && prev3?.musclePct)
      ? +(latest.musclePct - prev3.musclePct).toFixed(2) : null;

    // ── 2. Nutrition average (last 14 days) ──────────────────────────────────
    const recent14   = nutritionHistory.slice(-14).filter(d => d.kcal > 0);
    const recent7    = nutritionHistory.slice(-7).filter(d => d.kcal > 0);
    const avgKcal14  = recent14.length ? Math.round(recent14.reduce((s,d) => s+(d.kcal||0),0)/recent14.length) : null;
    const avgKcal7   = recent7.length  ? Math.round(recent7.reduce((s,d) => s+(d.kcal||0),0)/recent7.length)  : null;
    const avgProtein = recent14.length ? Math.round(recent14.reduce((s,d) => s+(d.protein||0),0)/recent14.length) : null;

    // ── 3. Training load (last 7 & 14 days) ──────────────────────────────────
    const now    = Date.now();
    const last7  = trainingDays.filter(d => (now - new Date(d.date+'T12:00:00').getTime()) / 86400000 <= 7);
    const last14 = trainingDays.filter(d => (now - new Date(d.date+'T12:00:00').getTime()) / 86400000 <= 14);

    const burnLast7        = last7.reduce((s,d)  => s+(d.totalCalories||0), 0);
    const burnLast14       = last14.reduce((s,d) => s+(d.totalCalories||0), 0);
    const avgDailyBurn7    = Math.round(burnLast7  / 7);
    const avgDailyBurn14   = Math.round(burnLast14 / 14);
    const avgActiveDayBurn = last7.length ? Math.round(burnLast7 / last7.length) : 0;
    const activeDays7      = last7.length;
    const hasStrength      = last7.some(d => d.types?.includes('strength'));
    const trainingDetails  = last7.map(d =>
      `${d.date}(${d.totalMinutes}min,${d.totalCalories}kcal,${d.types?.join('+')})`
    ).join(' | ');

    // ── 4. BMR + NEAT + TEF (Grundumsatz + Alltagsbewegung + Nahrungswärme) ───
    const bw        = latest?.weight             || null;
    const age       = userProfile.age            || 57;
    const gender    = userProfile.gender         || 'male';
    const height    = userProfile.height         || null;
    const actFactor = userProfile.activityFactor || 1.375;

    let bmr  = null;

    if (bw && height) {
      bmr = gender === 'female'
        ? 10*bw + 6.25*height - 5*age - 161
        : 10*bw + 6.25*height - 5*age + 5;
    } else if (latest?.bmr && latest.bmr > 0) {
      bmr = latest.bmr;   // direkt von der Körperwaage (z.B. Withings/Tanita)
    }

    // NEAT = Non-Exercise Activity Thermogenesis (tägliche Alltagsbewegung OHNE Sport)
    // Abgeleitet vom Aktivitätslevel: actFactor 1.2 (sitzend) → 1.725 (sehr aktiv)
    // Formel: NEAT = BMR × (actFactor - 1.05) × 0.85
    // Beispiel actFactor 1.375: BMR × 0.278 → bei 1593 kcal BMR ≈ 443 kcal NEAT
    let neat = null;
    let tef  = null;
    let tdeeBase = null;   // BMR + NEAT + TEF (Ruhetag, ohne Strava-Sport)

    if (bmr) {
      const neatMultiplier = Math.max(0.10, (actFactor - 1.05) * 0.85);
      neat     = Math.round(bmr * neatMultiplier);
      tef      = Math.round((bmr + neat) * 0.10);  // TEF ≈ 10% der aufgenommenen Energie
      tdeeBase = Math.round(bmr + neat + tef);      // Ruhetag-TDEE ohne Strava-Sport
    }

    // ── 5. RED-S risk assessment ──────────────────────────────────────────────
    const rapidWeightLoss  = weightTrend  !== null && weightTrend  < -1.0;
    const muscleLoss       = muscleTrend  !== null && muscleTrend  < -0.3;
    const muscleLossLong   = muscleTrend3 !== null && muscleTrend3 < -0.5;
    const highTrainingLoad = activeDays7 >= 5 || avgDailyBurn7 > 400;
    const redSRisk = (muscleLoss || muscleLossLong) && (rapidWeightLoss || highTrainingLoad);

    // ── 6. Feste Kalorie- und Makro-Vorgaben ──────────────────────────────────
    // Basis-Kalorienziel (ohne Sport) = 1800 kcal (fix)
    // An Sporttagen: 1800 + tatsächliche Strava-Kalorien (live im Frontend addiert)
    const kcalGoalRestDay  = 1800;
    // Tiered eat-back (Ø-Faktor ~0.75): VO2max→90%, >120min→88%, 60-120min→70%, ≤60min→55%
    // avgActiveDayBurn wird hier mit 0.75 geschätzt (frontend berechnet tagesaktuell exakt)
    const kcalGoalTrainDay = 1800 + Math.round(avgActiveDayBurn * 0.75);
    // VO2max-Tage: kein Defizit → volles TDEE als Basis (kein Kaloriendefizit, auch nicht im Grundumsatz)
    const kcalGoalVo2Day   = tdeeBase ? Math.round(tdeeBase) : kcalGoalRestDay + 400;
    const kcalGoal         = kcalGoalRestDay;
    const trainDayBonus    = avgActiveDayBurn;
    const deficitVsTdee    = tdeeBase ? tdeeBase - kcalGoalRestDay : null;

    // Feste Makro-Gramm-Ziele (nicht prozentual) – Carbs nach Aktivitätstyp:
    // Ruhetag / nur Gehen:              Protein 170g | Carbs 150g | Fett 85g | Faser 35g
    // Laufen oder Krafttraining:        Protein 170g | Carbs 200g | Fett 85g | Faser 35g
    // Zone 2 ≥ 90 min oder VO2max-Rad: Protein 170g | Carbs 300g | Fett 85g | Faser 35g
    const macroGoalsRestDay   = { proteinG: 170, carbsG: 120, fatG: 71, fiberG: 35 };
    const macroGoalsTrainDay  = { proteinG: 170, carbsG: 200, fatG: 85, fiberG: 35 };
    const macroGoalsCycleDay  = { proteinG: 170, carbsG: 300, fatG: 85, fiberG: 35 };

    const proteinMinG  = 160;
    const proteinPerKg = bw ? +(160 / bw).toFixed(1) : 2.1;

    // Wöchentliches Defizit (Schätzung)
    const trainingDaysPerWeek = activeDays7;
    const restDaysPerWeek     = 7 - trainingDaysPerWeek;
    const weeklyKcalIn  = (kcalGoalRestDay * restDaysPerWeek) +
                          ((kcalGoalRestDay + avgActiveDayBurn) * trainingDaysPerWeek);
    const weeklyKcalOut = tdeeBase ? (tdeeBase * 7 + burnLast7) : null;
    const weeklyDeficit = weeklyKcalOut ? Math.round(weeklyKcalIn - weeklyKcalOut) : null;

    const weightToLose = (latest?.weight && bodyGoals.weight)
      ? Math.max(0, latest.weight - bodyGoals.weight) : null;
    const estimatedWeeksToGoal = (weeklyDeficit && weeklyDeficit < 0 && weightToLose)
      ? Math.ceil(weightToLose / (Math.abs(weeklyDeficit) / 7700)) : null;

    // ── 7. Claude: nur Warnungen + Begründung ────────────────────────────────
    // Kalorien und Makros sind fix – Claude bewertet nur Trends und gibt Hinweise
    const prompt = `Du bist ein Sporternährungs-Experte. Analysiere diese Daten und gib kurze Hinweise.

## PROFIL
- Alter: ${age} Jahre | Gewicht: ${bw ?? '–'} kg | Größe: ${height ?? '–'} cm
- BMR: ${bmr ? Math.round(bmr) : '–'} kcal | TDEE Ruhetag: ${tdeeBase ?? '–'} kcal

## FESTE ZIELE (nicht ändern)
- Kalorien Ruhetag: 1800 kcal | Trainingstag: 1800 + tiered eat-back (VO2max→90%, >120min→88%, 60-120min→70%, ≤60min→55%) | VO2max-Tag: TDEE + 90% Strava-kcal
- Makros Ruhetag/Gehen:   Protein 170g | Carbs 120g | Fett 71g
- Makros Laufen/Kraft:    Protein 170g | Carbs 200g | Fett 85g
- Makros Zone2 ≥90min/VO2max-Rad: Protein 170g | Carbs 300g | Fett 85g
- TDEE-Differenz Ruhetag: ${deficitVsTdee !== null ? (deficitVsTdee > 0 ? '+' : '') + deficitVsTdee + ' kcal vs. TDEE' : '–'}

## KÖRPER-TREND
- Gewicht: ${weightTrend !== null ? (weightTrend>0?'+':'')+weightTrend+' kg' : '–'} (3 Mess.: ${weightTrend3 !== null ? (weightTrend3>0?'+':'')+weightTrend3+' kg' : '–'})
- Muskeln: ${muscleTrend !== null ? (muscleTrend>0?'+':'')+muscleTrend+'%' : '–'} | Viszeralfett: ${visceralTrend !== null ? (visceralTrend>0?'+':'')+visceralTrend : '–'}
- KFA: ${latest?.fatPct ?? '–'}% → Ziel ${bodyGoals.fatPct ?? '–'}% | Gewicht: ${latest?.weight ?? '–'} kg → Ziel ${bodyGoals.weight ?? '–'} kg
${muscleLoss || muscleLossLong ? '⚠ Muskelmasse nimmt ab!' : ''}
${rapidWeightLoss ? '⚠ Gewichtsverlust zu schnell!' : ''}
- RED-S Risiko: ${redSRisk ? '⚠ JA' : 'nein'}

## ERNÄHRUNG & TRAINING (IST)
- Ø Kalorien 14 Tage: ${avgKcal14 ?? '–'} kcal | Ø Protein: ${avgProtein ?? '–'} g
- Aktive Tage: ${activeDays7}/7 | Ø Sport: ${avgActiveDayBurn} kcal/Trainingstag
${last7.length > 0 ? '- Details: '+trainingDetails : ''}

Antworte NUR mit diesem JSON:
{
  "warnings": [<max. 3 deutsche Hinweise bei kritischen Trends, sonst leer>],
  "adjustmentReason": "<1-2 Sätze: Bewertung des aktuellen Fortschritts und ob die Ziele passen>"
}`;

    const geminiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5',
        max_tokens: 1024,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Claude API ${geminiRes.status}: ${errText.slice(0, 200)}`);
    }

    const geminiData = await geminiRes.json();
    const raw        = geminiData.content?.[0]?.text || '';
    const cleaned    = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonMatch  = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('KI hat kein gültiges JSON zurückgegeben. Antwort: ' + raw.slice(0, 200));

    const geminiResult = JSON.parse(jsonMatch[0]);

    // ── 8. Compose final response ─────────────────────────────────────────────
    return Response.json({
      // Calorie goals (deterministic)
      kcalGoal,           // = kcalGoalRestDay — Frontend addiert tagesaktuelle Strava-kcal
      kcalGoalRestDay,    // BMR + NEAT + TEF − Defizit
      kcalGoalTrainDay,   // Schätzung: kcalGoalRestDay + Ø Strava-Verbrauch
      kcalGoalVo2Day,     // Volles TDEE (kein Defizit) als Basis für VO2max-Tage
      trainDayBonus,      // = avgActiveDayBurn (Frontend nutzt tatsächliche Sportkalorien)
      // Komponenten (für Transparenz-Anzeige im UI)
      bmr:      bmr ? Math.round(bmr) : null,
      neat,
      tef,
      tdeeRestDay: tdeeBase,
      deficitApplied: deficitVsTdee ?? 300,
      // Protein (automatisch erhöht bei RED-S)
      proteinMinG,
      proteinPerKg,
      // Fixed macro gram targets
      macroGoalsRestDay,
      macroGoalsTrainDay,
      macroGoalsCycleDay,
      // Progress
      weeklyDeficit,
      estimatedWeeksToGoal,
      // From Claude
      warnings:         geminiResult.warnings        ?? [],
      adjustmentReason: geminiResult.adjustmentReason ?? '',
      // Flags
      redSRisk,
      analyzedAt: new Date().toISOString(),
    });

  } catch (err) {
    console.error('ki-adjust error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
};
