/**
 * validate-rules.mjs
 * Prüft die Regel-Einstellungen auf Inkonsistenzen, bevor sie gespeichert werden.
 * 1. Deterministische Mathe-/Logik-Checks (z.B. Untergrenze < Basis, Defizit < 0)
 * 2. KI-Plausibilitätsprüfung (RED-S-Risiko, Makro-Balance) via Claude
 *
 * POST { rules } → { valid, errors }
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
    if (num(rules.maintenanceBase) && num(rules.kcalRestBase)) {
      const deficit = rules.maintenanceBase - rules.kcalRestBase;
      if (deficit > 600) {
        errors.push(`Das resultierende Defizit (${deficit} kcal/Tag) liegt über 600 kcal – RED-S-Risiko. Basis oder Erhaltungskalorien anpassen.`);
      }
    }

    // Bei harten Fehlern: KI-Check überspringen, sofort zurückmelden
    if (errors.length > 0) {
      return Response.json({ valid: false, errors });
    }

    // ── 2. KI-Plausibilitätsprüfung (qualitativ) ──────────────────────────────
    const apiKey = Netlify.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return Response.json({ valid: true, errors: [] });
    }

    const deficitTrain = rules.maintenanceBase - rules.kcalRestBase;
    const deficitRest   = rules.maintenanceBase - rules.kcalMinDaily;

    const prompt = `Du bist ein Sporternährungs-Experte. Prüfe diese Ernährungs-/Trainingsregeln eines Radsportlers auf Inkonsistenzen oder Gesundheitsrisiken (z.B. RED-S, unausgewogene Makros, zu aggressives oder zu schwaches Defizit, unplausible Werte).

## REGELN
- Basis-Kalorienziel: ${rules.kcalRestBase} kcal | Untergrenze: ${rules.kcalMinDaily} kcal | Erhaltungskalorien: ${rules.maintenanceBase} kcal
- Resultierendes Defizit: ~${deficitTrain} kcal/Tag (Trainingstag), ~${deficitRest} kcal/Tag (Ruhetag) | Ziel-Defizit-Referenz: ${rules.referenceDeficit} kcal
- Strava-Korrektur: -${rules.stravaDeflation}% | Walk/Hike-Faktor: ${rules.walkHikeFactor}% | Kurze-Zone2-Faktor: ${rules.shortZone2Factor}% (< ${rules.shortZone2ThresholdMin} min)
- Makros Ruhetag/Gehen: P${rules.macroRest.protein}g C${rules.macroRest.carbs}g F${rules.macroRest.fat}g
- Makros Laufen/Kraft: P${rules.macroTrain.protein}g C${rules.macroTrain.carbs}g F${rules.macroTrain.fat}g
- Makros Zone2≥90min/VO2max: P${rules.macroCycle.protein}g C${rules.macroCycle.carbs}g F${rules.macroCycle.fat}g
- Ballaststoffe: ${rules.fiberGoal}g
- Carb-Schedule Radeinheiten: Stunde1 ${rules.carbHour1}g/h, Stunde2 ${rules.carbHour2}g/h, ab Stunde3 ${rules.carbHour3plus}g/h, sehr intensiv ${rules.carbIntense}g/h

Antworte NUR mit diesem JSON (kein Markdown):
{
  "valid": <true/false>,
  "issues": [<max. 5 kurze, konkrete deutsche Problembeschreibungen; leeres Array wenn alles plausibel ist>]
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
      // KI-Check technisch fehlgeschlagen → nicht blockieren, Basis-Validierung reicht
      return Response.json({ valid: true, errors: [] });
    }

    const aiData = await aiRes.json();
    const raw     = aiData.content?.[0]?.text || '';
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const match   = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return Response.json({ valid: true, errors: [] });

    const aiResult = JSON.parse(match[0]);
    const issues   = Array.isArray(aiResult.issues) ? aiResult.issues : [];

    return Response.json({
      valid:  aiResult.valid !== false && issues.length === 0,
      errors: issues,
    });

  } catch (err) {
    console.error('validate-rules error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
};
