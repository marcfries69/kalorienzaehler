// Netlify Function – KI-Coach Analyse via Claude (Anthropic)
export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY fehlt' }, { status: 500 });

    const { nutritionSummary, bodyMeasurements, bodyGoals } = await req.json();
    if (!nutritionSummary || !bodyMeasurements)
      return Response.json({ error: 'Ernährungs- oder Körperdaten fehlen' }, { status: 400 });

    const nutritionText = nutritionSummary.map(d =>
      `${d.date}: ${d.kcal} kcal, P ${d.protein}g, C ${d.carbs}g, F ${d.fat}g, Faser ${d.fiber}g`
    ).join('\n');

    const bodyText = bodyMeasurements.map(m =>
      `${m.date}: ${m.weight ?? '-'} kg, Fett ${m.fatPct ?? '-'}%, Muskeln ${m.musclePct ?? '-'}%, Viszeral ${m.visceralFat ?? '-'}`
    ).join('\n');

    const goalsText = bodyGoals
      ? `Ziel: ${bodyGoals.weight ?? '-'} kg, Fett ${bodyGoals.fatPct ?? '-'}%, Muskeln ${bodyGoals.musclePct ?? '-'}%, Viszeral ${bodyGoals.visceralFat ?? '-'}`
      : 'Keine Zielwerte';

    const prompt = `Du bist ein professioneller Ernährungs- und Fitness-Coach. Analysiere die Daten und gib konkrete Empfehlungen.

ERNÄHRUNG:
${nutritionText}

KÖRPERDATEN:
${bodyText}

ZIELE:
${goalsText}

Antworte NUR mit diesem JSON – kein Markdown:
{
  "summary": "2-3 Sätze Gesamtfazit",
  "recommendations": [
    {
      "title": "Kurzer Titel",
      "detail": "Konkrete Erklärung (2-3 Sätze)",
      "priority": "high"
    }
  ]
}

Gib 3-5 Empfehlungen. Beziehe dich auf die tatsächlichen Zahlen.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
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

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`);
    }

    const data    = await res.json();
    const raw     = data.content?.[0]?.text || '';
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const match   = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Kein gültiges JSON von KI erhalten');

    return Response.json(JSON.parse(match[0]));

  } catch (err) {
    console.error('coach-analysis error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
};
