// Netlify Function – Körperdaten aus Screenshot extrahieren (Gemini Vision)
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

    const { imageBase64, mimeType } = await req.json();

    if (!imageBase64) {
      return new Response(
        JSON.stringify({ error: 'Kein Bild übermittelt' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    console.log('📸 Analysiere Körperdaten-Screenshot...');

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                inlineData: {
                  mimeType: mimeType || 'image/jpeg',
                  data: imageBase64,
                }
              },
              {
                text: `Analysiere diesen Screenshot einer Körperanalyse-Waage oder Gesundheits-App und extrahiere alle sichtbaren Körperdaten.

Suche nach folgenden Werten (nicht alle müssen vorhanden sein):
- Gewicht (kg) → "weight"
- Körperfettanteil (%) → "fatPct"
- Muskelmasse (kg) → "muscleMassKg"
- Muskelmasseanteil (%) → "musclePct"
- Viszerales Fett (Wert oder Stufe, Zahl) → "visceralFat"
- BMI → "bmi"

Antworte NUR mit einem JSON-Objekt in diesem exakten Format, ohne Markdown oder Erklärungen:
{
  "weight": Zahl oder null,
  "fatPct": Zahl oder null,
  "muscleMassKg": Zahl oder null,
  "musclePct": Zahl oder null,
  "visceralFat": Zahl oder null,
  "bmi": Zahl oder null
}

Verwende null für Werte die nicht im Bild sichtbar sind. Zahlen als Dezimalzahlen (z.B. 23.5 statt "23,5").`
              }
            ]
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

    console.log('✅ Körperdaten extrahiert:', parsed);

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
