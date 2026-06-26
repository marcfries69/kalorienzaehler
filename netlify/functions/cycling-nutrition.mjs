/**
 * cycling-nutrition.mjs
 * Berechnet optimale Ernährung vor/während/nach einer Radeinheit.
 * POST { blocks: [{zone, minutes}], weightKg, ftpWatts? }
 */
export default async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) return Response.json({ error: 'ANTHROPIC_API_KEY fehlt' }, { status: 500 });

  const { blocks = [], weightKg = 75, ftpWatts, actual, rules = {} } = await req.json();
  if (!blocks.length) return Response.json({ error: 'Keine Trainingsblöcke angegeben' }, { status: 400 });

  const carbHour1     = rules.carbHour1     ?? 40;
  const carbHour2     = rules.carbHour2     ?? 60;
  const carbHour3plus = rules.carbHour3plus ?? 80;
  const carbIntense   = rules.carbIntense   ?? 80;

  // actual = { kcal, avgHR, maxHR, avgWatts, distanceKm, name, zoneSource }
  // Wenn gesetzt: Einheit ist absolviert → Fokus auf Recovery anhand echter Daten.
  const isActual = !!actual;

  const zoneLabel = {
    Z1: 'Zone 1 – Regeneration (<55 % FTP)',
    Z2: 'Zone 2 – Grundlage/Endurance (56–75 % FTP)',
    Z3: 'Zone 3 – Tempo (76–90 % FTP)',
    Z4: 'Zone 4 – Schwelle/Threshold (91–105 % FTP)',
    Z5: 'Zone 5 – VO₂max (106–120 % FTP)',
    Z6: 'Zone 6 – Anaerob/Sprint (>120 % FTP)',
  };

  // Rough kcal/min estimate per zone for context
  const zoneKcalPerMin = { Z1: 5, Z2: 7, Z3: 9, Z4: 11, Z5: 13, Z6: 15 };
  const totalMinutes = blocks.reduce((s, b) => s + (b.minutes || 0), 0);
  const estKcal = blocks.reduce((s, b) => s + (zoneKcalPerMin[b.zone] || 8) * (b.minutes || 0), 0);

  const blockLines = blocks.map(b =>
    `  • ${b.minutes} min ${zoneLabel[b.zone] || b.zone}`
  ).join('\n');

  // ── Carb schedule calculation (hard rules, not left to AI) ────────────────
  const isVeryIntense = blocks.some(b => ['Z4', 'Z5', 'Z6'].includes(b.zone));
  const duringNeeded  = totalMinutes > 60 || isVeryIntense;

  const carbSchedule = [];
  let totalDuringCarbsG = 0;
  {
    let remaining = totalMinutes;
    let hourNum   = 1;
    while (remaining > 0) {
      const thisHourMins = Math.min(60, remaining);
      const ratePerHour  = isVeryIntense ? carbIntense
                         : hourNum === 1  ? carbHour1
                         : hourNum === 2  ? carbHour2
                         :                  carbHour3plus;
      const carbs = Math.round(ratePerHour * (thisHourMins / 60));
      carbSchedule.push({ hour: hourNum, durationMin: thisHourMins, carbsG: carbs, ratePerHour });
      totalDuringCarbsG += carbs;
      remaining -= thisHourMins;
      hourNum++;
    }
  }
  // For sessions ≤60 min with no high-intensity: no during nutrition
  if (!duringNeeded) totalDuringCarbsG = 0;

  const carbScheduleLines = carbSchedule.map(s =>
    `  Stunde ${s.hour} (${s.durationMin} min): ${s.carbsG} g Carbs (${s.ratePerHour} g/h)`
  ).join('\n');

  // Tatsächlicher Energieverbrauch (aus Strava) bevorzugen, sonst Schätzung
  const energyKcal = isActual && actual.kcal > 0 ? Math.round(actual.kcal) : estKcal;

  const actualBlock = isActual ? `

## TATSÄCHLICHE EINHEIT (aus Strava synchronisiert)
Die Einheit ist ABGESCHLOSSEN. Passe vor allem den RECOVERY-Plan an die echten Daten an.
- Name: ${actual.name || 'Radeinheit'}
- Tatsächlicher Verbrauch: ${actual.kcal ? Math.round(actual.kcal) + ' kcal' : 'n/a'}
- Ø Herzfrequenz: ${actual.avgHR ? Math.round(actual.avgHR) + ' bpm' : 'n/a'}${actual.maxHR ? ` (max ${Math.round(actual.maxHR)})` : ''}
- Ø Leistung: ${actual.avgWatts ? Math.round(actual.avgWatts) + ' W' : 'n/a'}
- Distanz: ${actual.distanceKm ? actual.distanceKm + ' km' : 'n/a'}
- Zonenquelle: ${actual.zoneSource === 'power' ? 'Leistungsmesser' : actual.zoneSource === 'heartrate' ? 'Herzfrequenz' : 'geschätzt'}

RECOVERY-FOKUS:
- Dimensioniere Post-Workout-Carbs nach tatsächlichem Verbrauch (~1.0–1.2 g/kg KG in den ersten 1–2 h bei hoher Auslastung).
- Protein: 0.3–0.4 g/kg KG (≈ 20–30 g) zur Muskelproteinsynthese.
- Pre/During-Empfehlungen weiterhin angeben (für das nächste Mal als Referenz), aber Recovery hat Priorität.
` : '';

  const prompt = `Du bist ein Sporternährungs-Experte mit Fokus auf Radsport-Leistungsernährung.
${isActual
  ? 'Die folgende Radeinheit ist bereits ABGESCHLOSSEN. Erstelle einen an die tatsächlichen Daten angepassten Ernährungs- und vor allem Recovery-Plan.'
  : 'Berechne die optimale Ernährungsstrategie für folgende Radeinheit.'}

## ATHLET
- Gewicht: ${weightKg} kg${ftpWatts ? `\n- FTP: ${ftpWatts} Watt` : ''}

## TRAININGSEINHEIT
${blockLines}
- Gesamtdauer: ${totalMinutes} Minuten
- ${isActual ? 'Tatsächlicher' : 'Geschätzter'} Verbrauch: ~${energyKcal} kcal
- Intensitätsklasse: ${isVeryIntense ? 'SEHR INTENSIV (Z4/Z5/Z6 enthalten)' : 'moderat (Z1–Z3)'}${actualBlock}

## PFLICHT-KOHLENHYDRATWERTE WÄHREND DER BELASTUNG
Diese Werte sind FESTGELEGT und dürfen NICHT verändert werden:
${duringNeeded ? carbScheduleLines : '  Keine Kohlenhydrate nötig (≤60 min, geringe Intensität)'}
- Gesamt-Carbs während Fahrt: ${totalDuringCarbsG} g
- Benötigt: ${duringNeeded}

Regel für diesen Athleten:
${isVeryIntense
  ? `→ Sehr intensive Einheit: ${carbIntense} g/h Carbs von Beginn an (schnelle Carbs, z.B. Gels)`
  : `→ 1. Stunde: ${carbHour1} g/h | 2. Stunde: ${carbHour2} g/h | ab 3. Stunde: ${carbHour3plus} g/h`}

## VORGABEN
- Angaben in Gramm (Kohlenhydrate, Protein, Fett) und ml (Flüssigkeit)
- Konkrete, alltagstaugliche Lebensmittelempfehlungen
- WICHTIG: Die carbSchedule-Werte sind exakt wie oben vorgegeben zu übernehmen
- Elektrolyte ab 60 min oder bei hoher Intensität empfehlen
- Flüssigkeit: 500–750 ml/h bei moderater Intensität, 750–1000 ml/h bei hoher Intensität

Antworte NUR mit diesem JSON (kein Markdown):
{
  "totalEnergyKcal": <Zahl>,
  "pre": {
    "meal": {
      "timing": "<z.B. '2–3 Stunden vorher'>",
      "carbsG": <Zahl>, "proteinG": <Zahl>, "fatG": <Zahl>,
      "examples": "<z.B. 'Haferflocken mit Banane und Magerquark'>"
    },
    "snack": {
      "timing": "<z.B. '30–60 Minuten vorher'>",
      "carbsG": <Zahl>, "proteinG": <Zahl>, "fatG": <Zahl>,
      "examples": "<z.B. 'Banane oder Energieriegel'>"
    }
  },
  "during": {
    "needed": ${duringNeeded},
    "carbSchedule": ${JSON.stringify(carbSchedule)},
    "totalCarbsG": ${totalDuringCarbsG},
    "fluidMlTotal": <Zahl>,
    "fluidMlPerHour": <Zahl>,
    "electrolytes": <true/false>,
    "examples": "<z.B. 'Gel alle 30 min ab Min 30, Isotonisches Getränk durchgehend'>"
  },
  "post": {
    "immediate": {
      "timing": "innerhalb 30 Minuten",
      "carbsG": <Zahl>, "proteinG": <Zahl>, "fatG": <Zahl>,
      "examples": "<z.B. 'Recovery-Shake: Milch, Banane, Whey'>"
    },
    "meal": {
      "timing": "1–3 Stunden danach",
      "carbsG": <Zahl>, "proteinG": <Zahl>, "fatG": <Zahl>,
      "examples": "<z.B. 'Reis mit Hähnchen und Gemüse'>"
    }
  },
  "tips": ["<max. 3 kurze, einheitsspezifische Hinweise>"]
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
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
  if (!match) throw new Error('Kein gültiges JSON von KI: ' + raw.slice(0, 200));

  const result = JSON.parse(match[0]);
  // Ensure carbSchedule is always the computed values (not whatever AI returned)
  if (result.during) {
    result.during.carbSchedule   = carbSchedule;
    result.during.totalCarbsG    = totalDuringCarbsG;
    result.during.needed         = duringNeeded;
  }
  return Response.json({
    ...result,
    totalMinutes,
    weightKg,
    isVeryIntense,
    isActual,
    actual: isActual ? actual : null,
    calculatedAt: new Date().toISOString(),
  });
};
