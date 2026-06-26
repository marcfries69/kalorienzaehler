/**
 * validate-rules.mjs
 * Prüft die Regel-Einstellungen auf Inkonsistenzen, bevor sie gespeichert werden.
 *
 * 1. Deterministische Mathe-/Logik-Checks (z.B. Untergrenze < Basis, Defizit < 0).
 *    Diese allein entscheiden über "valid" – zuverlässig, da reine Arithmetik statt
 *    KI-Interpretation. Verschachtelte Prozentsätze (Pauschalkorrektur × Aktivitäts-
 *    faktor) werden hier bereits zu den tatsächlichen Effektivwerten verrechnet.
 * 2. KI-Plausibilitätsprüfung (RED-S-Risiko, Makro-Balance) via Claude – rein beratend
 *    (warnings), blockiert die Speicherung NICHT mehr. Bekommt die in Schritt 1
 *    bereits fertig verrechneten Effektivwerte, damit sie nicht selbst mit
 *    verschachtelten Prozentsätzen rechnen und sich dabei vertun kann.
 *
 * POST { rules } → { valid, errors, warnings }
 */
export default async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  try {
    const { rules } = await req.json();
    if (!rules) return Response.json({ error: 'rules fehlt' }, { status: 400 });

    const errors = [];
    const num = (v) => typeof v === 'number' && Number.isFinite(v);

    // ── 1. Deterministische Konsistenzprüfungen ───────────────────────────────
    if (!num(rules.kcalRestBase) || rules.kcalRestBase <= 0) errors.push('Basis-Kalorienziel muss eine positive Zahl sein.');
    if (!num(rules.kcalMinDaily) || rules.kcalMinDaily <= 0) errors.push('Tagesziel-Untergrenze muss eine positive Zahl sein.');
    if (!num(rules.maintenanceBase) || rules.maintenanceBase <= 0) errors.push('Erhaltungskalorien müssen eine positive Zahl sein.');

    if (num(rules.kcalMinDaily) && num(rules.kcalRestBase) && rules.kcalMinDaily < rules.kcalRestBase) {
      errors.push(`Untergrenze (${rules.kcalMinDaily} kcal) darf nicht unter der Basis (${rules.kcalRestBase} kcal) liegen – sonst greift der Floor nie.`);
    }
    if (num(rules.maintenanceBase) && num(rules.kcalRestBase) && rules.maintenanceBase <= rules.kcalRestBase) {
      errors.push(`Erhaltungskalorien (${rules.maintenanceBase}) müssen über der Basis (${rules.kcalRestBase}) liegen, sonst entsteht kein Defizit.`);
    }
    if (num(rules.maintenanceBase) && num(rules.kcalMinDaily) && rules.maintenanceBase <= rules.kcalMinDaily) {
      errors.push(`Erhaltungskalorien (${rules.maintenanceBase}) müssen über der Untergrenze (${rules.kcalMinDaily}) liegen, sonst entsteht am Ruhetag kein Defizit.`);
    }

    ['stravaDeflation', 'walkHikeFactor', 'shortZone2Factor'].forEach((key) => {
      if (!num(rules[key]) || rules[key] < 0 || rules[key] > 100) {
        errors.push(`"${key}" muss zwischen 0 und 100 (%) liegen.`);
      }
    });

    if (!num(rules.shortZone2ThresholdMin) || rules.shortZone2ThresholdMin <= 0 || rules.shortZone2ThresholdMin > 300) {
      errors.push('Schwelle "kurze Einheit" muss zwischen 1 und 300 Minuten liegen.');
    }

    const macroLabels = { macroRest: 'Ruhetag/Gehen', macroTrain: 'Laufen/Kraft', macroCycle: 'Zone2/VO2max' };
    Object.entries(macroLabels).forEach(([key, label]) => {
      const m = rules[key];
      if (!m || !num(m.protein) || !num(m.carbs) || !num(m.fat) || m.protein <= 0 || m.carbs <= 0 || m.fat <= 0) {
        errors.push(`Makroziel "${label}" benötigt positive Werte für Protein, Carbs und Fett.`);
      }
    });

    if (!num(rules.fiberGoal) || rules.fiberGoal <= 0) errors.push('Ballaststoffe-Ziel muss eine positive Zahl sein.');

    ['carbHour1', 'carbHour2', 'carbHour3plus', 'carbIntense'].forEach((key) => {
      if (!num(rules[key]) || rules[key] <= 0) errors.push(`Carb-Schedule "${key}" muss eine positive Zahl sein.`);
    });

    // Makro-kcal-Summe vs. Ruhetag-Basis (Toleranz ±15%)
    if (rules.macroRest && num(rules.kcalRestBase) &&
        num(rules.macroRest.protein) && num(rules.macroRest.carbs) && num(rules.macroRest.fat)) {
      const macroKcal = rules.macroRest.protein * 4 + rules.macroRest.carbs * 4 + rules.macroRest.fat * 9;
      if (Math.abs(macroKcal - rules.kcalRestBase) > rules.kcalRestBase * 0.15) {
        errors.push(`Ruhetag-Makros ergeben ${Math.round(macroKcal)} kcal, das Basis-Kalorienziel ist aber ${rules.kcalRestBase} kcal (Abweichung > 15%). Makros oder Basis anpassen.`);
      }
    }

    // Defizit-Sicherheit (RED-S-Schutz)
    const deficitTrain = num(rules.maintenanceBase) && num(rules.kcalRestBase) ? rules.maintenanceBase - rules.kcalRestBase : null;
    const deficitRest  = num(rules.maintenanceBase) && num(rules.kcalMinDaily) ? rules.maintenanceBase - rules.kcalMinDaily : null;
    if (deficitTrain !== null && deficitTrain > 600) {
      errors.push(`Das resultierende Defizit (${deficitTrain} kcal/Tag) liegt über 600 kcal – RED-S-Risiko. Basis oder Erhaltungskalorien anpassen.`);
    }

    // Effektive Gesamt-Anrechnung je Aktivitätstyp = Pauschalkorrektur × Aktivitätsfaktor
    // (verschachtelte Prozentsätze hier EINMAL korrekt verrechnet, damit weder die
    // KI-Prüfung noch das Frontend das selbst nachrechnen und sich dabei vertun müssen)
    let effectiveFactors = null;
    if (num(rules.stravaDeflation) && num(rules.walkHikeFactor) && num(rules.shortZone2Factor)) {
      const deflationKeep = (100 - rules.stravaDeflation) / 100; // z.B. -25% Abzug → 0.75 bleiben
      effectiveFactors = {
        normal:     +(deflationKeep * 1.0).toFixed(4),
        shortZone2: +(deflationKeep * (rules.shortZone2Factor / 100)).toFixed(4),
        walkHike:   +(deflationKeep * (rules.walkHikeFactor   / 100)).toFixed(4),
      };
    }

    // Bei harten Fehlern: KI-Check überspringen, sofort zurückmelden
    if (errors.length > 0) {
      return Response.json({ valid: false, errors, warnings: [] });
    }

    // ── 2. KI-Plausibilitätsprüfung (rein beratend, blockiert nicht) ──────────
    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
    if (!apiKey || !effectiveFactors) {
      return Response.json({ valid: true, errors: [], warnings: [] });
    }

    const pct = (f) => `${Math.round(f * 100)}%`;

    const prompt = `Du bist ein Sporternährungs-Experte. Gib NUR beratende Hinweise zu möglichen Risiken oder Unausgewogenheiten in diesen bereits gültigen Ernährungs-/Trainingsregeln eines Radsportlers. Du bewertest nicht die Mathematik (die ist bereits geprüft) – nur Plausibilität aus sportmedizinischer Sicht (z.B. RED-S-Risiko, Makro-Balance).

## BEREITS FERTIG VERRECHNETE WERTE (nicht selbst nachrechnen!)
- Tagesziel: ${rules.kcalRestBase} kcal (Sporttag-Basis) | ${rules.kcalMinDaily} kcal (Ruhetag-Untergrenze)
- Erhaltungskalorien ohne Sport: ${rules.maintenanceBase} kcal
- Resultierendes Defizit: ${deficitTrain} kcal/Tag (Trainingstag), ${deficitRest} kcal/Tag (Ruhetag) – Ziel-Referenz war ${rules.referenceDeficit} kcal
- Effektive Anrechnung der Sport-Kalorien vom Strava-Rohwert (bereits inkl. aller Korrekturfaktoren):
  normale Einheiten ${pct(effectiveFactors.normal)}, kurze Zone-2 (<${rules.shortZone2ThresholdMin}min) ${pct(effectiveFactors.shortZone2)}, Walk/Hike ${pct(effectiveFactors.walkHike)}
- Makros Ruhetag/Gehen: P${rules.macroRest.protein}g C${rules.macroRest.carbs}g F${rules.macroRest.fat}g | Ballaststoffe ${rules.fiberGoal}g
- Makros Laufen/Kraft: P${rules.macroTrain.protein}g C${rules.macroTrain.carbs}g F${rules.macroTrain.fat}g
- Makros Zone2≥90min/VO2max: P${rules.macroCycle.protein}g C${rules.macroCycle.carbs}g F${rules.macroCycle.fat}g
- Carb-Schedule Radeinheiten: Stunde1 ${rules.carbHour1}g/h, Stunde2 ${rules.carbHour2}g/h, ab Stunde3 ${rules.carbHour3plus}g/h, sehr intensiv ${rules.carbIntense}g/h

Antworte NUR mit diesem JSON (kein Markdown):
{
  "warnings": [<max. 3 kurze, konkrete deutsche Hinweise zu sportmedizinischen Risiken; leeres Array wenn unauffällig>]
}`;

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!aiRes.ok) {
      return Response.json({ valid: true, errors: [], warnings: [] });
    }

    const aiData = await aiRes.json();
    const raw     = aiData.content?.[0]?.text || '';
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const match   = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return Response.json({ valid: true, errors: [], warnings: [] });

    const aiResult = JSON.parse(match[0]);
    const warnings = Array.isArray(aiResult.warnings) ? aiResult.warnings : [];

    // KI-Hinweise sind beratend – die Speicherung wird dadurch NICHT blockiert,
    // weil eine KI-Fehlinterpretation der verschachtelten Prozentsätze sonst
    // gültige Konfigurationen dauerhaft hätte blockieren können.
    return Response.json({ valid: true, errors: [], warnings });

  } catch (err) {
    console.error('validate-rules error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
};
