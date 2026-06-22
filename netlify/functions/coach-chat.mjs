// Netlify Function – KI-Coach Chat via Claude (Anthropic)
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY fehlt' }, { status: 500 });

    const { messages, context } = await req.json();
    if (!messages || !context) {
      return Response.json({ error: 'messages oder context fehlen' }, { status: 400 });
    }

    // ── Kontext aufbauen ────────────────────────────────────────────────────────
    const {
      nutritionHistory = [],
      bodyMeasurements = [],
      bodyGoals        = null,
      trainingDays     = [],
      calorieGoalRest  = 1800,
      macroGoals       = {},
      todayDate        = '',
      todayMeals       = [],
    } = context;

    const nutritionText = nutritionHistory.length > 0
      ? nutritionHistory.map(d => {
          const training = trainingDays.find(t => t.date === d.date);
          const trainStr = training
            ? ` | Training: ${training.totalCalories} kcal, ${training.totalMinutes} min (${(training.types||[]).join('+')})`
            : '';
          if (d.estimated) {
            // Dieser Tag wurde nicht erfasst – nur Zielwert bekannt, keine echten Makrodaten
            return `${d.date}: ~${d.kcal} kcal (nicht erfasst – Tagesziel als Schätzwert)${trainStr}`;
          }
          return `${d.date}: ${d.kcal} kcal, P ${d.protein}g, C ${d.carbs}g, F ${d.fat}g, Faser ${d.fiber}g${trainStr}`;
        }).join('\n')
      : 'Keine Ernährungsdaten vorhanden';

    const bodyText = bodyMeasurements.length > 0
      ? bodyMeasurements.slice(-10).map(m =>
          `${m.date}: ${m.weight ?? '-'} kg, KFA ${m.fatPct ?? '-'}%, Muskeln ${m.musclePct ?? '-'}%, Viszeral ${m.visceralFat ?? '-'}, BMI ${m.bmi ?? '-'}`
        ).join('\n')
      : 'Keine Körperdaten vorhanden';

    const goalsText = bodyGoals
      ? `Ziel-Gewicht: ${bodyGoals.weight ?? '-'} kg | Ziel-KFA: ${bodyGoals.fatPct ?? '-'}% | Ziel-Muskeln: ${bodyGoals.musclePct ?? '-'}%`
      : 'Keine Körperziele definiert';

    const macroText = [
      `Kalorienziel Ruhetag: ${calorieGoalRest} kcal`,
      `Trainingstag: Grundwert + tiered eat-back (VO2max/Intervall→90%, >120min→88%, 60-120min→70%, ≤60min→55%), Tagesziel max. 3000 kcal`,
      `Strava-Kalorien werden pauschal um 20% nach unten korrigiert (Überschätzung)`,
      `Makroziel Ruhetag/Gehen: Protein 160g | Carbs 150g | Fett 62g`,
      `Makroziel Laufen/Kraft: Protein 170g | Carbs 200g | Fett 85g`,
      `Makroziel Zone2 ≥90min / VO2max-Rad: Protein 170g | Carbs 300g | Fett 85g`,
      macroGoals?.macroGoalsRestDay ? `(KI-Ziel Rest: P ${macroGoals.macroGoalsRestDay.proteinG}g | C ${macroGoals.macroGoalsRestDay.carbsG}g | F ${macroGoals.macroGoalsRestDay.fatG}g)` : '',
    ].filter(Boolean).join('\n');

    const todayText = todayMeals.length > 0
      ? todayMeals.map(m => `  - ${m.name}: ${m.kcal} kcal, P ${m.protein}g, C ${m.carbs}g, F ${m.fat}g`).join('\n')
      : 'Noch keine Mahlzeiten heute';

    const systemPrompt = `Du bist ein persönlicher Ernährungs- und Fitness-Coach. Du analysierst die Daten des Nutzers und gibst konkrete, motivierende und wissenschaftlich fundierte Empfehlungen auf Deutsch.

Sei direkt, präzise und beziehe dich stets auf die tatsächlichen Zahlen. Keine allgemeinen Floskeln – immer personalisiert.

═══ NUTZERDATEN ═══

ERNÄHRUNG – LETZTE 14 TAGE:
${nutritionText}

KÖRPERDATEN (neueste zuerst):
${bodyText}

KÖRPERZIELE:
${goalsText}

KALORIE- & MAKROZIELE:
${macroText}

HEUTIGE MAHLZEITEN (${todayDate}):
${todayText}

STRAVA-TRAININGS (letzte Einheiten):
${trainingDays.slice(-7).map(t =>
  `${t.date}: ${t.totalCalories} kcal, ${t.totalMinutes} min, ${(t.types||[]).join('+')}`
).join('\n') || 'Keine Strava-Daten'}

═══ VERHALTENSREGELN ═══
- Antworte immer auf Deutsch
- Halte Antworten prägnant (3-6 Sätze, außer der Nutzer fragt explizit nach mehr)
- Berechne Dinge konkret wenn gefragt (z.B. Defizit, Fortschritt zum Ziel)
- Erkenne Muster in den Daten (z.B. Wochentage mit schlechter Ernährung)
- Heutiger Tag: ${todayDate}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: 1024,
        system:     systemPrompt,
        messages:   messages, // Gesamter Chatverlauf
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`);
    }

    const data  = await res.json();
    const reply = data.content?.[0]?.text || '';

    return Response.json({ reply });

  } catch (err) {
    console.error('coach-chat error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
};
