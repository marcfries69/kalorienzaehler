/**
 * analyze-body-photo.mjs
 * Analysiert 1-n hochgeladene Körperfotos (eine Session, z.B. mehrere Blickwinkel
 * vom selben Tag) per Claude Vision und schätzt KFA sowie Fortschritt/Rückschritt
 * im Vergleich zu Referenzfotos (erstes + letzte Session).
 *
 * Fotos werden hier nur zur einmaligen Auswertung verarbeitet, NICHT serverseitig
 * gespeichert – die Persistenz übernimmt das Frontend (lokal, IndexedDB).
 *
 * POST {
 *   newPhotos: [{ date, image: "data:image/jpeg;base64,..." }, ...],
 *   referencePhotos: [{ date, image, label: "erstes"|"letztes" }],
 *   scaleData: { weight, fatPct, musclePct, visceralFat } | null
 * }
 * → { kfaEstimateLow, kfaEstimateHigh, trend, trendLabel, observations, summary }
 */
export default async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  try {
    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY fehlt' }, { status: 500 });

    const { newPhotos = [], referencePhotos = [], scaleData = null } = await req.json();
    if (newPhotos.length === 0) return Response.json({ error: 'newPhotos fehlt' }, { status: 400 });

    const toImageBlock = (dataUrl) => {
      const match = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl || '');
      if (!match) return null;
      return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
    };

    const newImageBlocks = newPhotos.map(p => toImageBlock(p.image)).filter(Boolean);
    if (newImageBlocks.length === 0) return Response.json({ error: 'newPhotos hat kein gültiges Bildformat' }, { status: 400 });

    const hasReferences = referencePhotos.length > 0;
    const newDate = newPhotos[0].date;

    const scaleText = scaleData
      ? `Aktuelle Waage-Werte (zur Einordnung, NICHT als Korrektur deiner visuellen Schätzung nutzen): Gewicht ${scaleData.weight ?? '–'} kg, KFA ${scaleData.fatPct ?? '–'}%, Muskelanteil ${scaleData.musclePct ?? '–'}%, Viszeralfett ${scaleData.visceralFat ?? '–'}`
      : 'Keine Waage-Daten verfügbar.';

    const content = [
      {
        type: 'text',
        text: `Du bist ein erfahrener Coach für Körperkomposition. Analysiere die NEUEN Foto(s) (Datum: ${newDate}) rein visuell.
${newImageBlocks.length > 1 ? `Es sind ${newImageBlocks.length} Aufnahmen derselben Person vom selben Tag (z.B. verschiedene Blickwinkel) – nutze alle zusammen für eine genauere Gesamteinschätzung, nicht als separate Bewertungen.` : ''}

${scaleText}

${hasReferences
  ? `Du bekommst zusätzlich ${referencePhotos.length} Referenzfoto(s) zum Vergleich, jeweils mit Label und Datum markiert. Vergleiche die neuen Fotos mit jedem Referenzfoto und beurteile, ob sich der Körper sichtbar verändert hat (Fortschritt, Rückschritt oder kein erkennbarer Unterschied).`
  : 'Dies ist die erste Aufnahme – es gibt noch keine Referenz. Erstelle nur eine Baseline-Einschätzung, kein Vergleich möglich.'}

Wichtig:
- Deine KFA-Schätzung soll UNABHÄNGIG von den Waage-Werten erfolgen, rein aus dem visuellen Eindruck (Muskeldefinition, Fettverteilung, Bauchregion etc.)
- Berücksichtige, dass Beleuchtung/Pose/Winkel die Wahrnehmung verzerren können – erwähne das, falls die Fotos schwer vergleichbar sind
- Sei ehrlich und konkret, keine Floskeln

Antworte NUR mit diesem JSON (kein Markdown):
{
  "kfaEstimateLow": <Zahl, untere Grenze der geschätzten Körperfett-Spanne in %>,
  "kfaEstimateHigh": <Zahl, obere Grenze>,
  "trend": ${hasReferences ? '"progress" | "regression" | "stable"' : '"baseline"'},
  "trendLabel": "<kurzes deutsches Label, z.B. 'Sichtbarer Fortschritt' oder 'Erste Aufnahme'>",
  "observations": [<max. 4 kurze, konkrete deutsche Beobachtungen zu Muskeldefinition/Fettverteilung/Veränderungen>],
  "summary": "<2-3 Sätze Gesamteinschätzung auf Deutsch>"
}`,
      },
      ...newImageBlocks,
    ];

    referencePhotos.forEach((ref) => {
      const block = toImageBlock(ref.image);
      if (block) {
        content.push({ type: 'text', text: `Referenzfoto (${ref.label || 'Referenz'}, ${ref.date}):` });
        content.push(block);
      }
    });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude API ${res.status}: ${err.slice(0, 300)}`);
    }

    const data = await res.json();
    const raw = data.content?.[0]?.text || '';
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('KI hat kein gültiges JSON zurückgegeben. Antwort: ' + raw.slice(0, 200));

    const result = JSON.parse(match[0]);

    return Response.json({
      kfaEstimateLow:  result.kfaEstimateLow  ?? null,
      kfaEstimateHigh: result.kfaEstimateHigh ?? null,
      trend:           result.trend           ?? (hasReferences ? 'stable' : 'baseline'),
      trendLabel:      result.trendLabel      ?? '',
      observations:    Array.isArray(result.observations) ? result.observations.slice(0, 4) : [],
      summary:         result.summary         ?? '',
      analyzedAt:      new Date().toISOString(),
    });
  } catch (err) {
    console.error('analyze-body-photo error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
};
