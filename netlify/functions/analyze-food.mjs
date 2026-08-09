// Netlify Function – Lebensmittelanalyse via Claude (Anthropic)
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY fehlt' }, { status: 500 });

    const { foodText } = await req.json();
    if (!foodText) return Response.json({ error: 'Keine Lebensmittel-Eingabe' }, { status: 400 });

    const prompt = `Du bist ein präziser Ernährungsanalyst. Analysiere die folgende Lebensmittelangabe und gib EXAKTE Nährwerte zurück.

DATENQUELLEN-PRIORITÄT (zwingend einhalten):
1. MARKENPRODUKTE & RESTAURANTKETTEN (McDonald's, Burger King, Subway, Starbucks, Nestlé, etc.):
   → Verwende AUSSCHLIESSLICH die offiziellen Nährwertangaben des Herstellers/Restaurants
   → Beispiele (Deutschland): McDonald's Egg McMuffin = 286 kcal | Big Mac = 508 kcal | McFlurry Oreo = 340 kcal
   → NIEMALS eigene Schätzungen für bekannte Markenprodukte – offizielle Werte sind Pflicht

2. GENERISCHE LEBENSMITTEL (Hafer, Hähnchenbrust, Brokkoli, etc.):
   → Nutze USDA FoodData Central oder BZfE-Nährwerttabellen als Referenz
   → Pro 100g: Haferflocken = 372 kcal | Hähnchenbrust (roh) = 105 kcal | Vollmilch = 64 kcal

3. HAUSGEMACHTE GERICHTE: Berechne anhand der Einzelzutaten mit Datenbankwerten

KRITISCHE FEHLER VERMEIDEN:
- Kalorien NIEMALS überschätzen – lieber den offiziellen/niedrigeren Wert verwenden
- Portionsgrößen genau beachten: Ein Muffin ≠ 100g-Rohware
- Keine Sicherheitszuschläge addieren
- Kohlenhydrate bei Fleisch/Fisch = 0, bei Nüssen sehr gering (5-15g/100g)

Lebensmittel: ${foodText}

GESUNDHEITS-BEWERTUNG (healthScore 1-6):
1 = Sehr gesund (Gemüse, Vollkorn, unverarbeitet)
2 = Gesund (mageres Fleisch, Nüsse, Obst)
3 = Okay (Vollkornprodukte mit etwas Zucker)
4 = Weniger gesund (Weißmehlprodukte, moderate Verarbeitung)
5 = Ungesund (Fast Food, frittiert, viel Zucker/Salz)
6 = Sehr ungesund (Süßigkeiten, stark verarbeitet, Transfette)

Antworte NUR mit diesem JSON – kein Markdown, keine Kommentare:
{
  "name": "Beschreibender Name der Mahlzeit",
  "healthScore": 1-6,
  "healthExplanation": "2-3 Sätze warum so bewertet",
  "components": [
    {
      "name": "Einzelbestandteil",
      "amount": "Mengenangabe mit Einheit",
      "kcal": Zahl,
      "protein": Zahl,
      "carbsComplex": Zahl (langkettige/komplexe Kohlenhydrate in g – Stärke aus Vollkorn, Hafer, Hülsenfrüchten, Kartoffeln, Gemüse etc., langsame Verdauung),
      "carbsSimple": Zahl (kurzkettige/einfache Kohlenhydrate in g – Zucker, Süßigkeiten, Weißmehl, Fruchtzucker, Honig, Softdrinks etc., schnelle Verdauung),
      "fatSaturated": Zahl (gesättigte Fettsäuren in g – Butter, Käse, fettes Fleisch, Wurst, Kokosöl, Sahne, Palmöl etc., LDL-relevant),
      "fatUnsaturated": Zahl (ungesättigte Fettsäuren in g – Olivenöl, Nüsse, Avocado, Fisch, Rapsöl etc.),
      "fiber": Zahl,
      "caffeine": Zahl (mg, 0 falls kein Koffein enthalten – z.B. Kaffee ~80mg/Tasse, Espresso ~63mg, Schwarztee ~40mg, Grüntee ~25mg, Cola ~30mg/330ml, Energy Drink ~80mg/250ml),
      "fruitG": Zahl (Menge Obst in dieser Komponente in g Frischgewicht, 0 falls kein Obst – Trockenfrüchte mit Faktor 3 auf Frischgewicht hochrechnen, kein Fruchtsaft),
      "vegetableG": Zahl (Menge Gemüse/Salat in dieser Komponente in g, 0 falls kein Gemüse – Hülsenfrüchte zählen mit, Kartoffeln NICHT da stärkehaltige Beilage)
    }
  ],
  "micronutrients": {
    "calcium": Zahl,
    "iron": Zahl,
    "magnesium": Zahl,
    "zinc": Zahl,
    "vitaminC": Zahl,
    "vitaminD": Zahl,
    "vitaminB12": Zahl,
    "folate": Zahl,
    "potassium": Zahl
  }
}

Mikronährstoff-Einheiten: calcium/iron/magnesium/zinc/vitaminC/potassium in mg, vitaminD/vitaminB12/folate in µg.`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':    'application/json',
        'x-api-key':       apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5',
        max_tokens: 1500,
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

    const parsed = JSON.parse(match[0]);
    const totals = parsed.components.reduce((acc, c) => ({
      kcal:           acc.kcal           + (c.kcal           || 0),
      protein:        acc.protein        + (c.protein        || 0),
      carbsComplex:   acc.carbsComplex   + (c.carbsComplex    || 0),
      carbsSimple:    acc.carbsSimple    + (c.carbsSimple     || 0),
      fatSaturated:   acc.fatSaturated   + (c.fatSaturated    || 0),
      fatUnsaturated: acc.fatUnsaturated + (c.fatUnsaturated  || 0),
      fiber:          acc.fiber          + (c.fiber           || 0),
      caffeine:       acc.caffeine       + (c.caffeine        || 0),
      fruitG:         acc.fruitG         + (c.fruitG          || 0),
      vegetableG:     acc.vegetableG     + (c.vegetableG       || 0),
    }), { kcal: 0, protein: 0, carbsComplex: 0, carbsSimple: 0, fatSaturated: 0, fatUnsaturated: 0, fiber: 0, caffeine: 0, fruitG: 0, vegetableG: 0 });
    // carbs/fat = Summe aus den Teil-Werten – so bleibt der Gesamtwert konsistent mit dem
    // Split, statt eine dritte, potenziell abweichende KI-Schätzung zu übernehmen. Gilt
    // auch pro Komponente, damit die Detail-Ansicht weiterhin carbs/fat-Werte hat.
    totals.carbs = Math.round((totals.carbsComplex + totals.carbsSimple) * 10) / 10;
    totals.fat = Math.round((totals.fatSaturated + totals.fatUnsaturated) * 10) / 10;
    const componentsWithCarbs = parsed.components.map(c => ({
      ...c,
      carbs: Math.round(((c.carbsComplex || 0) + (c.carbsSimple || 0)) * 10) / 10,
      fat: Math.round(((c.fatSaturated || 0) + (c.fatUnsaturated || 0)) * 10) / 10,
    }));

    return Response.json({
      name:             parsed.name,
      ...totals,
      components:       componentsWithCarbs,
      healthScore:      parsed.healthScore      || 3,
      healthExplanation: parsed.healthExplanation || '',
      micronutrients:   parsed.micronutrients   || null,
    });

  } catch (err) {
    console.error('analyze-food error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
};
