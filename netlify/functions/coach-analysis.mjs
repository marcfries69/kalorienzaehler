// Netlify Function – KI-Coach Analyse: Ernährung × Körperdaten
export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const apiKey = Netlify.env.get('GOOGLE_API_KEY');

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API Key nicht konfiguriert' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { nutritionSummary, bodyMeasurements, bodyGoals } = await req.json();

    if (!nutritionSummary || !bodyMeasurements) {
      return new Response(
        JSON.stringify({ error: 'Ernährungs- oder Körperdaten fehlen' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log('🤖 Starte Coach-Analyse...');

    const nutritionText = nutritionSummary.map(d =>
      `${d.date}: ${d.kcal} kcal, Protein ${d.protein}g, Carbs ${d.carbs}g, Fett ${d.fat}g, Ballaststoffe ${d.fiber}g (${d.mealCount} Mahlzeiten)`
    ).join('\n');

    const bodyText = bodyMeasurements.map(m =>
      `${m.date}: Gewicht ${m.weight ?? '-'} kg, Fett ${m.fatPct ?? '-'}%, Muskeln ${m.musclePct ?? '-'}%, Viszerales Fett ${m.visceralFat ?? '-'}`
    ).join('\n');

    const goalsText = bodyGoals
      ? `Zielgewicht: ${bodyGoals.weight ?? '-'} kg, Ziel-Fettanteil: ${bodyGoals.fatPct ?? '-'}%, Ziel-Muskelmasse: ${bodyGoals.musclePct ?? '-'}%, Ziel-Viszerales Fett: ${bodyGoals.visceralFat ?? '-'}`
      : 'Keine Zielwerte definiert';

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Du bist ein professioneller Ernährungs- und Fitness-Coach. Analysiere die folgenden Daten und gib konkrete, personalisierte Empfehlungen.

=== ERNÄHRUNGSDATEN (letzte Tage) ===
${nutritionText}

=== KÖRPERDATEN (Messungen) ===
${bodyText}

=== ZIELWERTE ===
${goalsText}

Analysiere:
1. Korrelationen zwischen Ernährung und Körperkomposition
2. Trends in den Körperdaten
3. Ob die Ernährung die Ziele unterstützt
4. Konkrete Verbesserungspotenziale

Antworte NUR mit einem JSON-Objekt in diesem exakten Format, ohne Markdown:
{
  "summary": "2-3 Sätze Gesamtfazit über den aktuellen Stand und Fortschritt",
  "recommendations": [
    {
      "title": "Kurzer Titel der Empfehlung",
      "detail": "Konkrete, umsetzbare Erklärung (2-3 Sätze)",
      "priority": "high" | "medium" | "low"
    }
  ]
}

Gib 3-5 Empfehlungen. Sei spezifisch und beziehe dich auf die tatsächlichen Zahlen.`
            }]
          }]
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Gemini API Error:', errorData);
      return new Response(
        JSON.stringify({ error: errorData.error?.message || 'API-Fehler' }),
        { status: response.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const text = data.candidates[0].content.parts[0].text.trim();
    const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonText);

    console.log('✅ Coach-Analyse abgeschlossen:', parsed.recommendations?.length, 'Empfehlungen');

    return new Response(
      JSON.stringify(parsed),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    );

  } catch (error) {
    console.error('Function Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Unbekannter Fehler' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
