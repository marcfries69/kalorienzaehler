/**
 * suggest-meals.mjs – Mahlzeitenvorschläge via Claude (Anthropic)
 */
export default async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY fehlt' }, { status: 500 });

    const {
      remainingKcal    = 500,
      remainingProtein = 30,
      remainingCarbs   = 50,
      remainingFat     = 20,
      remainingFiber   = 10,
      mealCount        = 5,
    } = await req.json();

    const prompt = `Du bist ein Ernährungsberater. Schlage ${mealCount} verschiedene Mahlzeiten vor, die das verbleibende Tagesziel abdecken.

VERBLEIBENDE MAKROS:
- Kalorien: ${Math.round(remainingKcal)} kcal
- Protein: ${Math.round(remainingProtein)} g
- Kohlenhydrate: ${Math.round(remainingCarbs)} g
- Fett: ${Math.round(remainingFat)} g
- Ballaststoffe: ${Math.round(remainingFiber)} g

ANFORDERUNGEN:
- Alltagstaugliche, realistische Mahlzeiten
- Verschiedene Kategorien: Hauptgericht, Snack, Salat, Suppe, Kombination etc.
- Mindestens 1-2 Vorschläge sollen KOMBINATIONEN sein, z.B. "Hähnchenbrust + Whey Isolat Shake" oder "Rührei + Magerquark + Beeren"
- Jedes Gericht deckt annähernd die verbleibenden Kalorien ab (±20%)
- "ingredients": genaue Mengenangaben für JEDE Zutat (z.B. "200g Hähnchenbrust, 150g Basmatireis (roh), 100g Brokkoli, 30g Whey Isolat")
- Kurze appetitliche Beschreibung auf Deutsch (1 Satz)

WICHTIG – NÄHRWERTE MÜSSEN EXAKT ZU DEN MENGEN PASSEN:
Berechne kcal, protein, carbs, fat, fiber AUSSCHLIESSLICH aus den tatsächlich angegebenen Zutatenmengen.
Verwende diese Referenzwerte pro 100g:
- Hähnchenbrust (roh): 110 kcal, 23g P, 0g K, 1g F
- Rinderhackfleisch (5% Fett): 121 kcal, 21g P, 0g K, 4g F
- Lachs: 208 kcal, 20g P, 0g K, 14g F
- Thunfisch (Dose, im Wasser): 116 kcal, 26g P, 0g K, 1g F
- Ei (1 Stück = 60g): 85 kcal, 7g P, 0g K, 6g F
- Magerquark: 67 kcal, 12g P, 4g K, 0.2g F
- Hüttenkäse: 98 kcal, 11g P, 3g K, 4g F
- Basmatireis (roh): 350 kcal, 7g P, 78g K, 1g F
- Haferflocken: 370 kcal, 13g P, 59g K, 7g F
- Süßkartoffel: 86 kcal, 2g P, 20g K, 0g F
- Whey Isolat (30g Portion): 110 kcal, 25g P, 2g K, 1g F
- Olivenöl (1 EL = 10g): 90 kcal, 0g P, 0g K, 10g F
Rechne präzise – keine Fantasie-Werte!

Antworte NUR mit diesem JSON – kein Markdown:
{
  "meals": [
    {
      "name": "<Gerichtsname oder Kombination>",
      "description": "<1 Satz>",
      "emoji": "<1 Emoji>",
      "ingredients": "<Zutaten mit genauen Mengenangaben, kommagetrennt>",
      "kcal": <Zahl>,
      "protein": <Zahl>,
      "carbs": <Zahl>,
      "fat": <Zahl>,
      "fiber": <Zahl>
    }
  ]
}`;

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

    const result = JSON.parse(match[0]);
    if (!Array.isArray(result.meals)) throw new Error('Unerwartetes Format');

    return Response.json({ meals: result.meals });

  } catch (err) {
    console.error('suggest-meals error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
};
