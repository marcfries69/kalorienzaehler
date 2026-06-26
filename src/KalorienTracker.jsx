import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Loader2, Send, Plus, Trash2, Flame, ChevronDown, Calculator,
  X, Check, ChevronLeft, ChevronRight, Droplets, BarChart2, Calendar, TrendingUp, Target, Settings,
  Brain, Upload, Scale, Dumbbell, RefreshCw, Sparkles, Activity, FileDown, Bike, Zap, Utensils, Wind
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const toDateKey = (d) => {
  const date = d instanceof Date ? d : new Date(d);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Tiered eat-back: Sportkalorien werden je nach Dauer/Intensität angerechnet.
// VO2max-Einheiten (jede Dauer):  90%  (hoher Erholungsbedarf)
// > 120 min:                      88%  (Langstrecke, Schätzung zuverlässiger)
// 60–120 min:                     70%  (mittlere Unsicherheit)
// ≤ 60 min, nicht VO2max:         55%  (höchste Inflationsrate bei Schätzwerten)
const _isRideAct = (a) => {
  const t = (a.type || a.sport_type || '').toLowerCase();
  return t.includes('ride') || t.includes('cycling') || t.includes('virtual');
};
const _isVo2Act = (a) => _isRideAct(a) && /vo2|intervall|interval|hiit/i.test(a.name || '');

const getEatbackFactor = (training) => {
  if (!training) return 0.9;
  const minutes    = training.totalMinutes || 0;
  const activities = training.activities   || [];
  if (activities.some(_isVo2Act)) return 0.9;   // VO2max immer 90%
  if (minutes > 120)              return 0.88;   // Langstrecke 88%
  if (minutes >= 60)              return 0.70;   // Mittel 70%
  return 0.55;                                   // Kurz 55%
};

/** Gibt die anrechenbaren Sportkalorien zurück (tiered eat-back). */
const tieredEatback = (training) =>
  Math.round((training?.totalCalories || 0) * getEatbackFactor(training));

// Tagesziel-Grenzen: nie unter 2000 (Schlaf/Regeneration) und nie über 3000 kcal.
const MIN_DAILY_KCAL = 2000;
const MAX_DAILY_KCAL = 3000;
const capDailyGoal = (kcal) => Math.min(Math.max(Math.round(kcal || 0), MIN_DAILY_KCAL), MAX_DAILY_KCAL);

// ── Mikronährstoff-Tagesziele (DGE-Referenzwerte) ────────────────────────────
const MICRO_TARGETS = [
  { key: 'calcium',    label: 'Kalzium',     unit: 'mg',  goal: 1000, color: 'sky',     emoji: '🦴' },
  { key: 'iron',       label: 'Eisen',       unit: 'mg',  goal: 14,   color: 'red',     emoji: '🩸' },
  { key: 'magnesium',  label: 'Magnesium',   unit: 'mg',  goal: 375,  color: 'teal',    emoji: '⚡' },
  { key: 'zinc',       label: 'Zink',        unit: 'mg',  goal: 10,   color: 'indigo',  emoji: '🔬' },
  { key: 'potassium',  label: 'Kalium',      unit: 'mg',  goal: 3500, color: 'orange',  emoji: '🍌' },
  { key: 'vitaminC',   label: 'Vitamin C',   unit: 'mg',  goal: 100,  color: 'yellow',  emoji: '🍊' },
  { key: 'vitaminD',   label: 'Vitamin D',   unit: 'µg',  goal: 20,   color: 'amber',   emoji: '☀️' },
  { key: 'vitaminB12', label: 'Vitamin B12', unit: 'µg',  goal: 4,    color: 'violet',  emoji: '💊' },
  { key: 'folate',     label: 'Folsäure',    unit: 'µg',  goal: 300,  color: 'lime',    emoji: '🥦' },
];

const DEFAULT_PRESETS = {
  rest:       { label: 'Rest Day',    emoji: '😴', kcal: 1800, proteinPct: 35, carbsPct: 30, fatPct: 35, fiberG: 25 },
  active:     { label: 'Active Day',  emoji: '🏃', kcal: 2200, proteinPct: 30, carbsPct: 45, fatPct: 25, fiberG: 30 },
  veryActive: { label: 'Very Active', emoji: '🔥', kcal: 2700, proteinPct: 25, carbsPct: 55, fatPct: 20, fiberG: 35 },
};

const KalorienTracker = () => {
  const todayKey = toDateKey(new Date());

  const [history, setHistory] = useState({});
  const [waterHistory, setWaterHistory] = useState({});
  const [selectedDate, setSelectedDate] = useState(() => toDateKey(new Date()));
  const [activeTab, setActiveTab] = useState('day');
  const [monthOffset, setMonthOffset] = useState(0); // 0 = aktueller Monat, -1 = Vormonat, ...
  const [weekOffset, setWeekOffset] = useState(0); // 0 = aktuelle 7-Tage-Periode, -1 = vorherige, ...
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [expandedMealId, setExpandedMealId] = useState(null);
  const [calorieGoal, setCalorieGoal] = useState(1800);
  const [showCalculator, setShowCalculator] = useState(false);
  const [calculatorData, setCalculatorData] = useState({
    gender: 'male', age: '', weight: '', height: '', activity: '1.2', goal: 'maintain'
  });
  const [calculatedGoal, setCalculatedGoal] = useState(null);
  const [macroGoals, setMacroGoals] = useState({ proteinPct: 30, carbsPct: 40, fatPct: 30, fiberG: 30 });
  const [showMacroGoals, setShowMacroGoals] = useState(false);
  const [showMicronutrients, setShowMicronutrients] = useState(false);
  const [macroDraft, setMacroDraft] = useState(null);
  const [presets, setPresets] = useState(DEFAULT_PRESETS);
  const [activePreset, setActivePreset] = useState(null);
  const [showPresetSettings, setShowPresetSettings] = useState(false);
  const [presetDraft, setPresetDraft] = useState(null);
  const [editingPresetKey, setEditingPresetKey] = useState('rest');

  // ── Body Tracking ────────────────────────────────────────────────────────────
  const [bodyMeasurements, setBodyMeasurements] = useState([]);
  const [bodyGoals, setBodyGoals] = useState({ weight: null, musclePct: null, fatPct: null, visceralFat: null });
  const [showBodyModal, setShowBodyModal] = useState(false);
  const [showBodyGoalsModal, setShowBodyGoalsModal] = useState(false);
  const [bodyDraft, setBodyDraft] = useState({ date: toDateKey(new Date()), weight: '', fatPct: '', musclePct: '', muscleMassKg: '', visceralFat: '', bmi: '' });
  const [bodyGoalsDraft, setBodyGoalsDraft] = useState({ weight: '', musclePct: '', fatPct: '', visceralFat: '' });
  const [bodyInputMode, setBodyInputMode] = useState('manual'); // 'manual' | 'screenshot'
  const [bodyScreenshotPreview, setBodyScreenshotPreview] = useState(null);
  const [loadingBody, setLoadingBody] = useState(false);
  const [showBodyHistory, setShowBodyHistory] = useState(false);
  const [coachAnalysis, setCoachAnalysis] = useState(null);
  const [loadingCoach, setLoadingCoach] = useState(false);
  const [chatMessages, setChatMessages] = useState([]); // {role:'user'|'assistant', content:string}
  const [chatInput, setChatInput] = useState('');
  const [loadingChat, setLoadingChat] = useState(false);
  const chatEndRef = useRef(null);
  // Cycling Nutrition
  const [cyclingBlocks, setCyclingBlocks] = useState([{ zone: 'Z2', minutes: 60 }]);
  const [cyclingFtp, setCyclingFtp] = useState('');
  const [cyclingWeight, setCyclingWeight] = useState(''); // leer = aus Körperdaten
  const [cyclingResult, setCyclingResult] = useState(null);
  const [loadingCycling, setLoadingCycling] = useState(false);
  const [cyclingError, setCyclingError] = useState(null);
  const [loadingRideSync, setLoadingRideSync] = useState(false);
  const [syncedRide, setSyncedRide] = useState(null); // zuletzt synchronisierte Strava-Einheit
  const [claudeCopied, setClaudeCopied] = useState(null); // 'training' | 'data' | null
  const [syncStatus, setSyncStatus] = useState(null); // null | 'syncing' | 'ok' | 'error'
  const [syncError, setSyncError] = useState(null);
  const [trainingSyncError, setTrainingSyncError] = useState(null);
  const [trainingDays, setTrainingDays] = useState(() => {
    try { return JSON.parse(localStorage.getItem('training-days') || '[]'); } catch { return []; }
  });
  const [trainingSyncAt, setTrainingSyncAt] = useState(() => localStorage.getItem('training-sync-at') || null);
  const [kiResult, setKiResult] = useState(() => {
    try {
      const r = JSON.parse(localStorage.getItem('ki-result') || 'null');
      // Discard stale results where calories were null (old bug)
      if (r && !r.kcalGoalRestDay && !r.kcalGoal) return null;
      // Invalidate cache if base calorie target changed (now 1800), if it still carries the
      // removed kcalGoalVo2Day field (old VO2max-base scheme), or rest-day macros are stale
      const staleRestMacros = r?.macroGoalsRestDay && (r.macroGoalsRestDay.carbsG !== 150 || r.macroGoalsRestDay.proteinG !== 150);
      if (r && r.kcalGoalRestDay && (r.kcalGoalRestDay !== 1800 || 'kcalGoalVo2Day' in r || staleRestMacros)) {
        localStorage.removeItem('ki-result');
        return null;
      }
      return r;
    } catch { return null; }
  });
  const [loadingKi, setLoadingKi] = useState(false);
  const [kiError, setKiError] = useState(null);
  const [lastSyncAt, setLastSyncAt] = useState(() => localStorage.getItem('body-sync-at') || null);
  const [mealSuggestions, setMealSuggestions] = useState(null);
  const [loadingMeals, setLoadingMeals] = useState(false);
  const [mealsError, setMealsError] = useState(null);
  const [showMealsModal, setShowMealsModal] = useState(false);
  const [todayOptimized, setTodayOptimized] = useState(null); // { kcalGoal, bonus, trainingToday, reason }

  // ── Auto-computed effective daily goal ───────────────────────────────────────
  // Formel: Ruhetag immer 2000 kcal. Sporttag: Basis 1800 kcal + Strava-Kalorien (inkl. Abschlag).
  // VO2max-Schutz läuft ausschließlich über den 90%-Eat-back-Tier, nicht über eine erhöhte Basis.
  const effectiveTodayGoal = useMemo(() => {
    const todayTraining = trainingDays.find(d => d.date === todayKey);
    const restBase = (kiResult?.kcalGoalRestDay > 0 ? kiResult.kcalGoalRestDay : null)
      || (calorieGoal > 0 ? calorieGoal : null)
      || 1800;
    // Alle Strava-Aktivitäten heute summieren (reagiert auf neue Syncs)
    // Tiered eat-back: je nach Dauer/Intensität 55–90% der Sportkalorien
    return capDailyGoal(restBase + tieredEatback(todayTraining));
  }, [trainingDays, todayKey, kiResult, calorieGoal]);

  // Sportkalorien-Bonus heute (für Anzeige)
  const todayTrainingBonus = useMemo(() => {
    const todayTraining = trainingDays.find(d => d.date === todayKey);
    // Tiered eat-back je nach Dauer/Intensität
    return tieredEatback(todayTraining);
  }, [trainingDays, todayKey]);

  // ── PDF Export (14-Tage-Report) ───────────────────────────────────────────
  const exportPDF = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();

    // ── Header ────────────────────────────────────────────────────────────────
    doc.setFillColor(20, 184, 166); // teal-500
    doc.rect(0, 0, pageW, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Ernährungs-Report – 14 Tage', 14, 12);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const exportDate = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    doc.text(`Exportiert am ${exportDate}`, 14, 22);

    // ── Letzte 14 Tage sammeln ────────────────────────────────────────────────
    const days14 = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      return toDateKey(d);
    });

    // Körperdaten-Map
    const bodyMap = {};
    bodyMeasurements.forEach(m => { bodyMap[m.date] = m; });

    // Strava-Map
    const stravaMap = {};
    trainingDays.forEach(t => { stravaMap[t.date] = t; });

    // Tabellenzeilen aufbauen (landscape: A4 quer für mehr Spalten)
    const kcalBase = (kiResult?.kcalGoalRestDay > 0 ? kiResult.kcalGoalRestDay : null) || 1800;
    const rowGoals = []; // per-day goal for color coding
    const rows = days14.map(dateKey => {
      const meals   = history[dateKey] || [];
      const kcal    = Math.round(meals.reduce((s, m) => s + (m.kcal    || 0), 0));
      const prot    = Math.round(meals.reduce((s, m) => s + (m.protein || 0), 0));
      const carbs   = Math.round(meals.reduce((s, m) => s + (m.carbs   || 0), 0));
      const fat     = Math.round(meals.reduce((s, m) => s + (m.fat     || 0), 0));
      const fiber   = Math.round(meals.reduce((s, m) => s + (m.fiber   || 0), 0));
      const body    = bodyMap[dateKey];
      const strava  = stravaMap[dateKey];
      const sportKcal  = strava?.totalCalories || 0;
      const sportMin   = strava?.totalMinutes  || 0;
      const sportTypes = strava?.types?.join('+') || '';
      const dayGoal    = capDailyGoal(kcalBase + tieredEatback(strava));   // Grundwert + tiered eat-back, gedeckelt
      rowGoals.push(dayGoal);
      const delta      = kcal ? kcal - dayGoal : null;
      const deltaLabel = delta !== null ? (delta > 0 ? `+${delta}` : `${delta}`) : '–';
      const weight  = body?.weight ? `${body.weight}` : '–';
      const kfa     = body?.fatPct ? `${body.fatPct}%` : '–';
      const label   = new Date(dateKey + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
      const sportLabel = sportKcal > 0 ? `${sportKcal}\n${sportMin}min${sportTypes ? ' '+sportTypes : ''}` : '–';
      return [label, kcal || '–', prot || '–', carbs || '–', fat || '–', fiber || '–',
              sportLabel, dayGoal, deltaLabel, weight, kfa];
    });

    // Summen / Durchschnitt
    const tracked = days14.filter(d => (history[d] || []).length > 0);
    const n = tracked.length || 1;
    const avg = tracked.reduce((acc, d) => {
      const meals  = history[d] || [];
      const strava = stravaMap[d];
      return {
        kcal:  acc.kcal  + meals.reduce((s, m) => s + (m.kcal    || 0), 0),
        prot:  acc.prot  + meals.reduce((s, m) => s + (m.protein || 0), 0),
        carbs: acc.carbs + meals.reduce((s, m) => s + (m.carbs   || 0), 0),
        fat:   acc.fat   + meals.reduce((s, m) => s + (m.fat     || 0), 0),
        fiber: acc.fiber + meals.reduce((s, m) => s + (m.fiber   || 0), 0),
        sport: acc.sport + (strava?.totalCalories || 0),
      };
    }, { kcal: 0, prot: 0, carbs: 0, fat: 0, fiber: 0, sport: 0 });

    // Landscape für mehr Spalten
    const docL = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWL = docL.internal.pageSize.getWidth();

    // Header
    docL.setFillColor(20, 184, 166);
    docL.rect(0, 0, pageWL, 22, 'F');
    docL.setTextColor(255, 255, 255);
    docL.setFontSize(16);
    docL.setFont('helvetica', 'bold');
    docL.text('Ernährungs- & Trainings-Report – 14 Tage', 14, 10);
    docL.setFontSize(8);
    docL.setFont('helvetica', 'normal');
    docL.text(`Exportiert am ${exportDate}  ·  Kalorienmonitor`, 14, 18);

    // ── Haupttabelle ──────────────────────────────────────────────────────────
    docL.setTextColor(30, 41, 59);
    docL.setFontSize(10);
    docL.setFont('helvetica', 'bold');
    docL.text('Tagesübersicht', 14, 32);

    autoTable(docL, {
      startY: 36,
      head: [['Datum', 'Gegessen\n(kcal)', 'Protein\n(g)', 'Carbs\n(g)', 'Fett\n(g)', 'Faser\n(g)',
              'Sport\n(kcal/min)', 'Tagesziel\n(kcal)', 'Differenz\n(kcal)', 'Gewicht\n(kg)', 'KFA']],
      body: rows,
      foot: [[
        `Ø ${n} Tage`,
        Math.round(avg.kcal  / n) || '–',
        Math.round(avg.prot  / n) || '–',
        Math.round(avg.carbs / n) || '–',
        Math.round(avg.fat   / n) || '–',
        Math.round(avg.fiber / n) || '–',
        Math.round(avg.sport / n) || '–',
        `${kcalBase}+Ø${Math.round(avg.sport/n)||0}`,
        '–', '–', '–'
      ]],
      styles:      { fontSize: 7.5, cellPadding: 2 },
      headStyles:  { fillColor: [20, 184, 166], textColor: 255, fontStyle: 'bold', halign: 'center' },
      footStyles:  { fillColor: [241, 245, 249], textColor: [51, 65, 85], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 24 },
        1: { cellWidth: 20, halign: 'right' },
        2: { cellWidth: 18, halign: 'right' },
        3: { cellWidth: 18, halign: 'right' },
        4: { cellWidth: 16, halign: 'right' },
        5: { cellWidth: 14, halign: 'right' },
        6: { cellWidth: 28, halign: 'center' },
        7: { cellWidth: 22, halign: 'right' },
        8: { cellWidth: 20, halign: 'right' },
        9: { cellWidth: 20, halign: 'right' },
        10: { cellWidth: 16, halign: 'right' },
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      didParseCell: (data) => {
        if (data.section === 'body') {
          const rowGoal = rowGoals[data.row.index] || kcalBase;
          // Gegessen: grün wenn ≤ Tagesziel, rot wenn >10% über Ziel
          if (data.column.index === 1) {
            const val = Number(String(data.cell.raw).replace(/[^0-9]/g, ''));
            if (val > rowGoal * 1.1) data.cell.styles.textColor = [239, 68, 68];
            else if (val > 0 && val <= rowGoal) data.cell.styles.textColor = [22, 163, 74];
          }
          // Sport: blau wenn Training vorhanden
          if (data.column.index === 6 && data.cell.raw !== '–') {
            data.cell.styles.textColor = [37, 99, 235];
            data.cell.styles.fontStyle = 'bold';
          }
          // Tagesziel: teal-Farbe wenn Trainingstag (Ziel > Basis)
          if (data.column.index === 7) {
            if (rowGoal > kcalBase) data.cell.styles.textColor = [5, 150, 105];
          }
          // Differenz: grün wenn negativ (unter Ziel), rot wenn positiv (über Ziel)
          if (data.column.index === 8 && data.cell.raw !== '–') {
            const raw = String(data.cell.raw);
            if (raw.startsWith('-')) data.cell.styles.textColor = [22, 163, 74];
            else if (raw.startsWith('+')) data.cell.styles.textColor = [239, 68, 68];
          }
        }
      },
    });

    const finalYL = docL.lastAutoTable.finalY + 10;

    // ── Makro-Balken ──────────────────────────────────────────────────────────
    docL.setFont('helvetica', 'bold');
    docL.setFontSize(10);
    docL.setTextColor(30, 41, 59);
    docL.text('Ø Makro-Verteilung (14 Tage)', 14, finalYL);

    const total = avg.prot + avg.carbs + avg.fat || 1;
    const pPct  = Math.round(avg.prot  / total * 100);
    const cPct  = Math.round(avg.carbs / total * 100);
    const fPct  = 100 - pPct - cPct;
    const barX  = 14, barY = finalYL + 5, barH = 8, barW = pageWL - 28;
    const pW = barW * pPct / 100, cW = barW * cPct / 100, fW = barW * fPct / 100;

    docL.setFillColor(59, 130, 246);  docL.rect(barX,        barY, pW, barH, 'F');
    docL.setFillColor(245, 158, 11);  docL.rect(barX + pW,   barY, cW, barH, 'F');
    docL.setFillColor(168, 85, 247);  docL.rect(barX+pW+cW,  barY, fW, barH, 'F');

    docL.setFontSize(7.5);
    docL.setTextColor(255, 255, 255);
    if (pW > 14) docL.text(`P ${pPct}%`, barX + pW/2,        barY + 5.5, { align: 'center' });
    if (cW > 14) docL.text(`C ${cPct}%`, barX + pW + cW/2,   barY + 5.5, { align: 'center' });
    if (fW > 14) docL.text(`F ${fPct}%`, barX+pW+cW + fW/2,  barY + 5.5, { align: 'center' });

    const ly = barY + barH + 7;
    docL.setTextColor(71, 85, 105);
    docL.setFontSize(8);
    docL.setFillColor(59, 130, 246);  docL.rect(14,  ly-3, 5, 4, 'F'); docL.text(`Protein: Ø ${Math.round(avg.prot/n)}g`, 21, ly);
    docL.setFillColor(245, 158, 11);  docL.rect(80,  ly-3, 5, 4, 'F'); docL.text(`Carbs: Ø ${Math.round(avg.carbs/n)}g`, 87, ly);
    docL.setFillColor(168, 85, 247);  docL.rect(150, ly-3, 5, 4, 'F'); docL.text(`Fett: Ø ${Math.round(avg.fat/n)}g`, 157, ly);
    docL.setFillColor(22, 163, 74);   docL.rect(220, ly-3, 5, 4, 'F'); docL.text(`Sport: Ø ${Math.round(avg.sport/n)} kcal/Tag`, 227, ly);

    // Footer
    const pageHL = docL.internal.pageSize.getHeight();
    docL.setFontSize(7);
    docL.setTextColor(148, 163, 184);
    docL.text('Kalorienmonitor · kalorienmonitor.netlify.app', pageWL / 2, pageHL - 5, { align: 'center' });

    const filename = `ernaehrung-report-${exportDate.replace(/\./g, '-')}.pdf`;
    docL.save(filename);

    const finalY = doc.lastAutoTable.finalY + 10;

  };

  const messagesEndRef = useRef(null);
  const bodyFileRef = useRef(null);

  // ── Load ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      let hist = {};
      const savedHist = localStorage.getItem('history-data');
      if (savedHist) hist = JSON.parse(savedHist);

      // Migrate old format
      const oldMeals = localStorage.getItem('meals-data');
      if (oldMeals) {
        const parsed = JSON.parse(oldMeals);
        if (parsed?.length > 0) {
          hist[todayKey] = [...(hist[todayKey] || []), ...parsed];
          localStorage.setItem('history-data', JSON.stringify(hist));
        }
        localStorage.removeItem('meals-data');
      }

      setHistory(hist);

      const savedWater = localStorage.getItem('water-history');
      if (savedWater) setWaterHistory(JSON.parse(savedWater));

      const savedGoal = localStorage.getItem('calorie-goal');
      const parsedGoal = parseInt(savedGoal);
      // Migrate old base values to current base (1800)
      if ([2200, 2100, 2000, 1950, 1900].includes(parsedGoal)) {
        localStorage.setItem('calorie-goal', '1800');
        setCalorieGoal(1800);
      } else if (savedGoal && !isNaN(parsedGoal) && parsedGoal > 0) {
        setCalorieGoal(parsedGoal);
      }
      // Clean up stale "null" string from previous KI bug
      if (savedGoal === 'null' || savedGoal === 'NaN') localStorage.removeItem('calorie-goal');

      const savedMacros = localStorage.getItem('macro-goals');
      if (savedMacros) setMacroGoals(JSON.parse(savedMacros));

      const savedPresets = localStorage.getItem('presets-data');
      if (savedPresets) setPresets(JSON.parse(savedPresets));

      const savedActivePreset = localStorage.getItem('active-preset');
      if (savedActivePreset) setActivePreset(savedActivePreset);

      const savedBodyMeasurements = localStorage.getItem('body-measurements');
      if (savedBodyMeasurements) setBodyMeasurements(JSON.parse(savedBodyMeasurements));

      const savedBodyGoals = localStorage.getItem('body-goals');
      if (savedBodyGoals) setBodyGoals(JSON.parse(savedBodyGoals));

      const savedCalcData = localStorage.getItem('calculator-data');
      if (savedCalcData) setCalculatorData(JSON.parse(savedCalcData));
    } catch (e) {
      console.error('Ladefehler:', e);
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  // ── Body sync ────────────────────────────────────────────────────────────────
  const syncBodyData = async (silent = false) => {
    if (!silent) setSyncStatus('syncing');
    setSyncError(null);
    try {
      const res = await fetch('/.netlify/functions/sync-body');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sync fehlgeschlagen');
      const sorted = [...json.measurements].sort((a, b) => a.date.localeCompare(b.date));
      localStorage.setItem('body-measurements', JSON.stringify(sorted));
      localStorage.setItem('body-sync-at', json.syncedAt);
      setBodyMeasurements(sorted);
      setLastSyncAt(json.syncedAt);
      setSyncStatus('ok');
      setTimeout(() => setSyncStatus(null), 3000);
    } catch (err) {
      setSyncStatus('error');
      setSyncError(err.message);
    }
  };

  // Auto-sync on load: if last sync was > 30 min ago (or never)
  // Auto-sync + auto KI-adjust on load
  useEffect(() => {
    const lastSync  = localStorage.getItem('body-sync-at');
    const lastKi    = localStorage.getItem('ki-adjusted-at');
    const syncStale = !lastSync || (Date.now() - new Date(lastSync).getTime()) > 30 * 60 * 1000;
    const kiStale   = !lastKi  || (Date.now() - new Date(lastKi).getTime())   > 24 * 60 * 60 * 1000;

    const doSync = async () => {
      if (syncStale) {
        await Promise.all([syncBodyData(true), syncTrainingData(true)]);
      }
      // Auto-run KI after sync if stale (> 24h since last adjust)
      if (kiStale) {
        // Small delay to ensure state is populated from sync
        setTimeout(() => runKiAdjust(true), 2000);
      }
    };
    doSync();
  }, []);

  // ── Training sync ────────────────────────────────────────────────────────────
  const syncTrainingData = async (silent = false) => {
    setTrainingSyncError(null);
    try {
      const res  = await fetch('/.netlify/functions/sync-training');
      let json;
      try { json = await res.json(); }
      catch { throw new Error(`Sync-Training: Server gab kein JSON zurück (Status ${res.status})`); }
      if (!res.ok) throw new Error(json.error || `Training-Sync fehlgeschlagen (${res.status})`);
      if (!Array.isArray(json.days)) throw new Error('Unerwartetes Format von sync-training');
      localStorage.setItem('training-days', JSON.stringify(json.days));
      localStorage.setItem('training-sync-at', json.syncedAt);
      setTrainingDays(json.days);
      setTrainingSyncAt(json.syncedAt);
    } catch (err) {
      setTrainingSyncError(err.message); // always surface error
      console.warn('Training sync:', err.message);
    }
  };

  // ── KI-Intelligenz ───────────────────────────────────────────────────────────
  const runKiAdjust = async (silent = false) => {
    if (!silent) setLoadingKi(true);
    setKiError(null);
    try {
      // Always read fresh data from localStorage to avoid stale closure issues
      const freshBodyMeasurements = (() => { try { return JSON.parse(localStorage.getItem('body-measurements') || '[]'); } catch { return []; } })();
      const freshTrainingDays     = (() => { try { return JSON.parse(localStorage.getItem('training-days')     || '[]'); } catch { return []; } })();
      const freshHistory          = (() => { try { return JSON.parse(localStorage.getItem('history-data')      || '{}'); } catch { return {}; } })();
      const freshBodyGoals        = (() => { try { return JSON.parse(localStorage.getItem('body-goals')        || 'null') || bodyGoals; } catch { return bodyGoals; } })();
      const freshCalcData         = (() => { try { return JSON.parse(localStorage.getItem('calculator-data')   || 'null') || calculatorData; } catch { return calculatorData; } })();
      const freshMacroGoals       = (() => { try { return JSON.parse(localStorage.getItem('macro-goals')       || 'null') || macroGoals; } catch { return macroGoals; } })();
      const freshCalGoal          = (() => { const v = parseInt(localStorage.getItem('calorie-goal')); return v > 0 ? v : calorieGoal; })();

      // Build nutrition history from stored history (last 14 days)
      // Only include days with real tracked meals (exclude auto-correction placeholders)
      const nutritionHistory = Object.entries(freshHistory)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-14)
        .map(([date, meals]) => {
          const realMeals = meals.filter(m => !m.isAutoCorrection);
          if (realMeals.length === 0) return null; // skip auto-correction-only days
          return {
            date,
            kcal:    Math.round(realMeals.reduce((s, m) => s + (m.kcal    || 0), 0)),
            protein: Math.round(realMeals.reduce((s, m) => s + (m.protein || 0), 0)),
            carbs:   Math.round(realMeals.reduce((s, m) => s + (m.carbs   || 0), 0)),
            fat:     Math.round(realMeals.reduce((s, m) => s + (m.fat     || 0), 0)),
            fiber:   Math.round(realMeals.reduce((s, m) => s + (m.fiber   || 0), 0)),
          };
        })
        .filter(d => d && d.kcal > 0);

      const res  = await fetch('/.netlify/functions/ki-adjust', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          bodyMeasurements: freshBodyMeasurements,
          bodyGoals:        freshBodyGoals,
          nutritionHistory,
          trainingDays:     freshTrainingDays,
          currentKcalGoal:  freshCalGoal,
          macroGoals:       freshMacroGoals,
          userProfile: {
            age:           freshCalcData.age    ? +freshCalcData.age    : null,
            gender:        freshCalcData.gender || 'male',
            height:        freshCalcData.height ? +freshCalcData.height : null,
            activityFactor: freshCalcData.activity ? +freshCalcData.activity : 1.375,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'KI-Analyse fehlgeschlagen');

      // Apply new goals — only update if KI returned a valid calorie goal
      if (json.kcalGoal && json.kcalGoal > 0) {
        setCalorieGoal(json.kcalGoal);
        localStorage.setItem('calorie-goal', String(json.kcalGoal));
      }
      if (json.macros) {
        let macros = { ...json.macros };
        const kcalBase = json.kcalGoal || 1700;
        // Protein hard cap: max 170g unabhängig von KI-Ausgabe
        const maxProteinPct = Math.floor((170 * 4 / kcalBase) * 100);
        if (macros.proteinPct > maxProteinPct) {
          const freed = macros.proteinPct - maxProteinPct;
          macros.proteinPct = maxProteinPct;
          macros.carbsPct   = (macros.carbsPct || 30) + freed; // freie kcal zu Carbs
        }
        // Sicherstellen dass Summe = 100%
        const total = macros.proteinPct + macros.carbsPct + macros.fatPct;
        if (total !== 100) macros.carbsPct = Math.max(10, macros.carbsPct + (100 - total));
        if (json.redSRisk && json.proteinMinG && kcalBase > 0) {
          // Bei RED-S: Protein-Minimum sicherstellen (aber max 170g)
          const minProteinPct = Math.ceil((Math.min(json.proteinMinG, 170) * 4 / kcalBase) * 100);
          if (macros.proteinPct < minProteinPct) {
            const diff = minProteinPct - macros.proteinPct;
            macros.proteinPct = minProteinPct;
            macros.carbsPct   = Math.max(10, (macros.carbsPct || 35) - diff);
          }
        }
        const newMacros = { proteinPct: macros.proteinPct, carbsPct: macros.carbsPct, fatPct: macros.fatPct, fiberG: macros.fiberG };
        setMacroGoals(newMacros);
        localStorage.setItem('macro-goals', JSON.stringify(newMacros));
      }

      const now = new Date().toISOString();
      localStorage.setItem('ki-result', JSON.stringify(json));
      localStorage.setItem('ki-adjusted-at', now);
      setKiResult(json);
      setTodayOptimized(null);
    } catch (err) {
      if (!silent) setKiError(err.message);
      else console.warn('Auto KI-adjust:', err.message);
    } finally {
      if (!silent) setLoadingKi(false);
    }
  };

  // ── Optimize today ───────────────────────────────────────────────────────────
  const optimizeToday = () => {
    const today        = trainingDays.find(d => d.date === todayKey);
    const alreadyEaten = (history[todayKey] || []).reduce((s, m) => s + (m.kcal || 0), 0);

    // Use day-type-specific KI goals if available
    let adjustedGoal;
    let trainingBonus = 0;
    let reasonParts   = [];

    if (today && today.totalCalories > 0) {
      // Sporttag: Basis 1800 kcal + Strava-Kalorien (inkl. Abschlag). VO2max-Schutz
      // läuft über den 90%-Eat-back-Tier (getEatbackFactor), nicht über eine erhöhte Basis.
      const restBase  = kiResult?.kcalGoalRestDay || 1800;
      const rawBurn   = today.totalCalories;
      const factor    = getEatbackFactor(today);
      const pctAbzug  = Math.round((1 - factor) * 100);
      trainingBonus = tieredEatback(today);
      adjustedGoal  = capDailyGoal(restBase + trainingBonus);
      reasonParts.push(`Trainingstag: ${adjustedGoal} kcal (${restBase} Basis + ${trainingBonus} von ${rawBurn} Strava −${pctAbzug}%, ${today.totalMinutes} Min)`);
    } else {
      // Rest day – nie unter 2000 kcal (Schlaf/Regeneration)
      adjustedGoal = capDailyGoal(kiResult?.kcalGoalRestDay || 1800);
      reasonParts.push(`Ruhetag: ${adjustedGoal} kcal`);
    }

    // Carry-over: if yesterday was under/over goal, partially compensate
    const yesterday = toDateKey(new Date(Date.now() - 86400000));
    const yesterdayMeals = history[yesterday] || [];
    if (yesterdayMeals.length > 0) {
      const yesterdayKcal = Math.round(yesterdayMeals.reduce((s, m) => s + (m.kcal || 0), 0));
      const delta = yesterdayKcal - adjustedGoal;
      if (Math.abs(delta) > 100) {
        const carry = Math.round(delta * -0.25); // compensate 25% of yesterday's delta
        const cappedCarry = Math.max(-200, Math.min(200, carry));
        adjustedGoal += cappedCarry;
        if (cappedCarry !== 0) {
          reasonParts.push(`${cappedCarry > 0 ? '+' : ''}${cappedCarry} kcal Übertrag (gestern ${delta > 0 ? '+' : ''}${delta} kcal)`);
        }
      }
    }

    adjustedGoal = capDailyGoal(adjustedGoal);

    const remaining = Math.max(0, adjustedGoal - Math.round(alreadyEaten));
    const reason    = reasonParts.length > 0 ? reasonParts.join(' · ') : 'Kein Training heute, kein Übertrag';

    setTodayOptimized({
      kcalGoal:      adjustedGoal,
      bonus:         trainingBonus,
      remaining,
      alreadyEaten:  Math.round(alreadyEaten),
      trainingToday: today || null,
      reason,
    });
  };

  // ── Meal suggestions ─────────────────────────────────────────────────────────
  const suggestMeals = async (remainingKcal, remainingMacros) => {
    setLoadingMeals(true);
    setMealsError(null);
    setMealSuggestions(null);
    setShowMealsModal(true);
    try {
      const res = await fetch('/.netlify/functions/suggest-meals', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          remainingKcal,
          remainingProtein: remainingMacros.protein,
          remainingCarbs:   remainingMacros.carbs,
          remainingFat:     remainingMacros.fat,
          remainingFiber:   remainingMacros.fiber,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Vorschläge konnten nicht geladen werden');
      setMealSuggestions(json.meals);
    } catch (err) {
      setMealsError(err.message);
    } finally {
      setLoadingMeals(false);
    }
  };

  // ── Persist ─────────────────────────────────────────────────────────────────
  const saveHistory = (newHistory) => {
    // Auto-clean: past days whose real meals now reach ≥ 1500 kcal lose their correction entry
    const cleaned = {};
    for (const [date, meals] of Object.entries(newHistory)) {
      if (!Array.isArray(meals) || date === todayKey || !meals.some(m => m.isAutoCorrection)) {
        cleaned[date] = meals;
        continue;
      }
      const realKcal    = meals.filter(m => !m.isAutoCorrection).reduce((s, m) => s + (m.kcal || 0), 0);
      const withoutCorr = meals.filter(m => !m.isAutoCorrection);
      if (realKcal >= 1500) {
        if (withoutCorr.length > 0) cleaned[date] = withoutCorr;
        // else: omit date entirely
      } else {
        cleaned[date] = meals;
      }
    }
    setHistory(cleaned);
    localStorage.setItem('history-data', JSON.stringify(cleaned));
  };

  const saveWater = (newWaterHistory) => {
    setWaterHistory(newWaterHistory);
    localStorage.setItem('water-history', JSON.stringify(newWaterHistory));
  };

  const saveCalorieGoal = (goal) => {
    localStorage.setItem('calorie-goal', goal.toString());
    setCalorieGoal(goal);
  };

  const saveMacroGoals = (goals) => {
    setMacroGoals(goals);
    localStorage.setItem('macro-goals', JSON.stringify(goals));
  };

  const savePresets = (newPresets) => {
    setPresets(newPresets);
    localStorage.setItem('presets-data', JSON.stringify(newPresets));
  };

  const saveBodyMeasurements = (data) => {
    setBodyMeasurements(data);
    localStorage.setItem('body-measurements', JSON.stringify(data));
  };

  const saveBodyGoalsData = (goals) => {
    setBodyGoals(goals);
    localStorage.setItem('body-goals', JSON.stringify(goals));
  };

  const applyPreset = (key) => {
    const p = presets[key];
    saveCalorieGoal(p.kcal);
    saveMacroGoals({ proteinPct: p.proteinPct, carbsPct: p.carbsPct, fatPct: p.fatPct, fiberG: p.fiberG });
    setActivePreset(key);
    localStorage.setItem('active-preset', key);
  };

  // ── Computed macro goals in grams ────────────────────────────────────────────
  // Carb-Ziele nach Aktivitätstyp:
  //   Ruhetag / nur Gehen              → 150g
  //   Laufen oder Krafttraining        → 200g
  //   Radfahren ≥ 90 min (Zone 2)      → 300g
  //   Radfahren mit VO2max-Training    → 300g (unabhängig von Dauer)
  // Protein: 170g immer
  const todayTrainingEntry = trainingDays.find(d => d.date === todayKey);
  const todayActivities    = todayTrainingEntry?.activities || [];
  const todayHasStrength   = todayTrainingEntry?.types?.includes('strength') ?? false;
  const todayHasRun        = todayActivities.some(a => (a.type||'').toLowerCase().includes('run'));
  const isRideActivity     = a => { const t = (a.type||'').toLowerCase(); return t.includes('ride') || t.includes('cycling') || t.includes('virtual'); };
  const isVo2maxRide       = a => isRideActivity(a) && /vo2|intervall|interval|hiit/i.test(a.name||'');
  const todayLongRide      = todayActivities.some(a => isRideActivity(a) && (a.minutes||0) >= 90);
  const todayVo2maxRide    = todayActivities.some(isVo2maxRide);
  const todayIsTrainingDay = todayHasStrength || todayHasRun || todayLongRide || todayVo2maxRide;

  const macroGoalGrams = (() => {
    let protein = 150, carbs, fat;
    if (todayLongRide || todayVo2maxRide)     { carbs = 300; fat = 85; } // Zone 2 ≥90 min oder VO2max
    else if (todayHasRun || todayHasStrength) { carbs = 200; fat = 85; }
    else                                       { carbs = 150; fat = 66; } // Ruhetag/Gehen → passt auf 1800 kcal
    return { protein, carbs, fat, fiber: 35 };
  })();

  // ── Derived state ────────────────────────────────────────────────────────────
  const currentMeals = history[selectedDate] || [];
  const currentWater = waterHistory[selectedDate] || 0;
  const isToday = selectedDate === todayKey;

  const totals = currentMeals.reduce((acc, meal) => {
    const mn = meal.micronutrients || {};
    return {
      kcal:    acc.kcal    + (meal.kcal    || 0),
      protein: acc.protein + (meal.protein || 0),
      carbs:   acc.carbs   + (meal.carbs   || 0),
      fat:     acc.fat     + (meal.fat     || 0),
      fiber:   acc.fiber   + (meal.fiber   || 0),
      calcium:    acc.calcium    + (mn.calcium    || 0),
      iron:       acc.iron       + (mn.iron       || 0),
      magnesium:  acc.magnesium  + (mn.magnesium  || 0),
      zinc:       acc.zinc       + (mn.zinc       || 0),
      potassium:  acc.potassium  + (mn.potassium  || 0),
      vitaminC:   acc.vitaminC   + (mn.vitaminC   || 0),
      vitaminD:   acc.vitaminD   + (mn.vitaminD   || 0),
      vitaminB12: acc.vitaminB12 + (mn.vitaminB12 || 0),
      folate:     acc.folate     + (mn.folate     || 0),
    };
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0,
       calcium: 0, iron: 0, magnesium: 0, zinc: 0, potassium: 0,
       vitaminC: 0, vitaminD: 0, vitaminB12: 0, folate: 0 });
  // Whether at least one meal today has micronutrient data
  const hasMicroData = currentMeals.some(m => m.micronutrients);

  // ── Date navigation ──────────────────────────────────────────────────────────
  const navigateDay = (dir) => {
    const d = new Date(selectedDate + 'T12:00:00');
    d.setDate(d.getDate() + dir);
    const key = toDateKey(d);
    if (key <= todayKey) setSelectedDate(key);
  };

  const formatDisplayDate = (dateKey) => {
    if (dateKey === todayKey) return 'Heute';
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (dateKey === toDateKey(yesterday)) return 'Gestern';
    const d = new Date(dateKey + 'T12:00:00');
    return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  };

  useEffect(() => {
    if (activeTab === 'day') messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // ── Auto-backfill: Tage < 1500 kcal erhalten Tagesziel als Korrektureintrag ─
  // Läuft auch ohne kiResult (Fallback auf calorieGoal/1800), wird erneut ausgeführt
  // wenn kiResult verfügbar wird (z.B. nach ki-adjust API-Aufruf).
  useEffect(() => {
    const restBase  = (kiResult?.kcalGoalRestDay > 0 ? kiResult.kcalGoalRestDay : null) || calorieGoal || 1800;

    let freshHistory;
    try { freshHistory = JSON.parse(localStorage.getItem('history-data') || '{}'); } catch { return; }

    let changed = false;
    for (let i = 1; i <= 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateKey    = toDateKey(d);
      const dayMeals   = Array.isArray(freshHistory[dateKey]) ? freshHistory[dateKey] : [];
      const realKcal   = dayMeals.filter(m => !m.isAutoCorrection).reduce((s, m) => s + (m.kcal || 0), 0);
      const hasCorr    = dayMeals.some(m => m.isAutoCorrection);

      if (realKcal >= 1500) {
        // Real meals sufficient – remove any stale correction
        if (hasCorr) {
          const cleaned = dayMeals.filter(m => !m.isAutoCorrection);
          if (cleaned.length > 0) freshHistory[dateKey] = cleaned;
          else delete freshHistory[dateKey];
          changed = true;
        }
      } else {
        // Below threshold – add/update correction entry
        const training = trainingDays.find(t => t.date === dateKey);
        const dayGoal  = capDailyGoal(restBase + tieredEatback(training));
        const existing = dayMeals.find(m => m.isAutoCorrection);

        if (!existing || existing.kcal !== dayGoal) {
          freshHistory[dateKey] = [
            ...dayMeals.filter(m => !m.isAutoCorrection),
            {
              id:              `auto-correction-${dateKey}`,
              name:            'Tagesziel (nicht erfasst)',
              kcal:            dayGoal,
              protein:         0,
              carbs:           0,
              fat:             0,
              fiber:           0,
              healthScore:     null,
              isAutoCorrection: true,
              correctedAt:     new Date().toISOString(),
            },
          ];
          changed = true;
        }
      }
    }

    if (changed) {
      localStorage.setItem('history-data', JSON.stringify(freshHistory));
      setHistory(freshHistory);
    }
  }, [kiResult, trainingDays, calorieGoal]); // eslint-disable-line react-hooks/exhaustive-deps


  // ── Water ────────────────────────────────────────────────────────────────────
  const addWater = (amount) => {
    const newVal = Math.round(Math.max(0, currentWater + amount) * 100) / 100;
    saveWater({ ...waterHistory, [selectedDate]: newVal });
  };

  const resetWater = () => saveWater({ ...waterHistory, [selectedDate]: 0 });

  // ── Meals ────────────────────────────────────────────────────────────────────
  const deleteMeal = (id) => {
    saveHistory({ ...history, [selectedDate]: currentMeals.filter(m => m.id !== id) });
  };

  const clearDay = () => {
    if (!window.confirm('Alle Mahlzeiten dieses Tages löschen?')) return;
    const newHistory = { ...history };
    delete newHistory[selectedDate];
    saveHistory(newHistory);
  };

  // ── AI submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    const userInput = input;
    setInput('');
    try {
      const res = await fetch('/.netlify/functions/analyze-food', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ foodText: userInput }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Fehler'); }
      const nutrition = await res.json();
      const newMeal = {
        id: Date.now(),
        time: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
        ...nutrition,
      };
      saveHistory({ ...history, [selectedDate]: [...currentMeals, newMeal] });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      alert('Fehler: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  // ── Body Tracking handlers ───────────────────────────────────────────────────
  const handleBodyScreenshot = async (file) => {
    if (!file) return;
    setLoadingBody(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      setBodyScreenshotPreview(dataUrl);
      const base64 = dataUrl.split(',')[1];
      const mimeType = file.type || 'image/jpeg';
      try {
        const res = await fetch('/.netlify/functions/analyze-body', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64, mimeType }),
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Fehler'); }
        const extracted = await res.json();
        setBodyDraft(prev => ({
          ...prev,
          weight:      extracted.weight      != null ? String(extracted.weight)      : prev.weight,
          fatPct:      extracted.fatPct      != null ? String(extracted.fatPct)      : prev.fatPct,
          musclePct:   extracted.musclePct   != null ? String(extracted.musclePct)   : prev.musclePct,
          muscleMassKg:extracted.muscleMassKg!= null ? String(extracted.muscleMassKg): prev.muscleMassKg,
          visceralFat: extracted.visceralFat != null ? String(extracted.visceralFat) : prev.visceralFat,
          bmi:         extracted.bmi         != null ? String(extracted.bmi)         : prev.bmi,
        }));
      } catch (err) {
        alert('Fehler beim Auslesen: ' + err.message);
      } finally {
        setLoadingBody(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const addBodyMeasurement = () => {
    const entry = {
      date: bodyDraft.date || toDateKey(new Date()),
      weight:       bodyDraft.weight       ? parseFloat(bodyDraft.weight)       : null,
      fatPct:       bodyDraft.fatPct       ? parseFloat(bodyDraft.fatPct)       : null,
      musclePct:    bodyDraft.musclePct    ? parseFloat(bodyDraft.musclePct)    : null,
      muscleMassKg: bodyDraft.muscleMassKg ? parseFloat(bodyDraft.muscleMassKg) : null,
      visceralFat:  bodyDraft.visceralFat  ? parseFloat(bodyDraft.visceralFat)  : null,
      bmi:          bodyDraft.bmi          ? parseFloat(bodyDraft.bmi)          : null,
    };
    const updated = [...bodyMeasurements.filter(m => m.date !== entry.date), entry]
      .sort((a, b) => a.date.localeCompare(b.date));
    saveBodyMeasurements(updated);
    setShowBodyModal(false);
    setBodyScreenshotPreview(null);
    setBodyDraft({ date: toDateKey(new Date()), weight: '', fatPct: '', musclePct: '', muscleMassKg: '', visceralFat: '', bmi: '' });
  };

  const runCoachAnalysis = async () => {
    setLoadingCoach(true);
    setCoachAnalysis(null);
    try {
      const last14 = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = toDateKey(d);
        const meals = history[key] || [];
        const realMeals = meals.filter(m => !m.isAutoCorrection);
        if (realMeals.length > 0) {
          const totals = realMeals.reduce((a, m) => ({
            kcal: a.kcal + (m.kcal || 0), protein: a.protein + (m.protein || 0),
            carbs: a.carbs + (m.carbs || 0), fat: a.fat + (m.fat || 0), fiber: a.fiber + (m.fiber || 0),
          }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
          last14.push({ date: key, ...Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round(v)])), mealCount: realMeals.length });
        }
      }
      const res = await fetch('/.netlify/functions/coach-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nutritionSummary: last14, bodyMeasurements, bodyGoals }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Fehler'); }
      const analysis = await res.json();
      setCoachAnalysis({ ...analysis, generatedAt: new Date().toLocaleString('de-DE') });
    } catch (err) {
      alert('Coach-Analyse Fehler: ' + err.message);
    } finally {
      setLoadingCoach(false);
    }
  };

  // ── Coach Chat ───────────────────────────────────────────────────────────────
  const sendChatMessage = async (overrideText) => {
    const text = (overrideText ?? chatInput).trim();
    if (!text || loadingChat) return;
    setChatInput('');

    const userMsg = { role: 'user', content: text };
    const updatedMessages = [...chatMessages, userMsg];
    setChatMessages(updatedMessages);
    setLoadingChat(true);

    // Scroll to bottom
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

    try {
      // Ernährungskontext letzte 14 Tage aufbauen
      // Auto-Korrektur-Tage werden als "geschätzt" markiert (Makros fehlen)
      const last14 = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const key = toDateKey(d);
        const meals = history[key] || [];
        const realMeals = meals.filter(m => !m.isAutoCorrection);
        const isCorrected = meals.some(m => m.isAutoCorrection);
        if (realMeals.length > 0) {
          const t = realMeals.reduce((a, m) => ({
            kcal: a.kcal + (m.kcal || 0), protein: a.protein + (m.protein || 0),
            carbs: a.carbs + (m.carbs || 0), fat: a.fat + (m.fat || 0), fiber: a.fiber + (m.fiber || 0),
          }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
          last14.push({ date: key, ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v)])) });
        } else if (isCorrected) {
          // Tag nicht erfasst – nur Kaloriengeschätzwert, keine Makros
          const corrKcal = meals.find(m => m.isAutoCorrection)?.kcal || 0;
          last14.push({ date: key, kcal: corrKcal, protein: null, carbs: null, fat: null, fiber: null, estimated: true });
        }
      }
      const todayMeals = history[todayKey]?.filter(m => !m.isAutoCorrection) || [];

      const res = await fetch('/.netlify/functions/coach-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: updatedMessages,
          context: {
            nutritionHistory: last14,
            bodyMeasurements,
            bodyGoals,
            trainingDays,
            calorieGoalRest: capDailyGoal(kiResult?.kcalGoalRestDay || calorieGoal || 1800),
            macroGoals: kiResult,
            todayDate: todayKey,
            todayMeals,
          },
        }),
      });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error || 'Fehler'); }
      const { reply } = await res.json();
      setChatMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `⚠️ Fehler: ${err.message}` }]);
    } finally {
      setLoadingChat(false);
    }
  };

  // ── Cycling Nutrition ────────────────────────────────────────────────────────
  const calcCyclingNutrition = async () => {
    if (cyclingBlocks.length === 0 || cyclingBlocks.every(b => !b.minutes)) return;
    setLoadingCycling(true);
    setCyclingError(null);
    setCyclingResult(null);
    try {
      const latest = bodyMeasurements[bodyMeasurements.length - 1];
      const weightKg = cyclingWeight ? +cyclingWeight : (latest?.weight || 75);
      const res = await fetch('/.netlify/functions/cycling-nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocks: cyclingBlocks.filter(b => b.minutes > 0),
          weightKg,
          ftpWatts: cyclingFtp ? +cyclingFtp : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler');
      setCyclingResult(data);
    } catch (err) {
      setCyclingError(err.message);
    } finally {
      setLoadingCycling(false);
    }
  };

  // Holt die zuletzt absolvierte Strava-Rad-Einheit und passt den Recovery-Plan
  // an die tatsächlichen Daten an.
  const syncRideFromStrava = async () => {
    setLoadingRideSync(true);
    setCyclingError(null);
    try {
      const rideRes = await fetch('/.netlify/functions/sync-ride');
      const ride = await rideRes.json();
      if (!rideRes.ok) throw new Error(ride.error || 'Strava-Sync fehlgeschlagen');
      if (!ride.found) {
        setCyclingError(ride.message || 'Keine Rad-Einheit gefunden.');
        return;
      }

      // UI mit tatsächlichen Blöcken aktualisieren
      if (Array.isArray(ride.blocks) && ride.blocks.length > 0) {
        setCyclingBlocks(ride.blocks);
      }
      setSyncedRide(ride.activity);

      // Recovery-Plan auf Basis der echten Daten berechnen
      const latest   = bodyMeasurements[bodyMeasurements.length - 1];
      const weightKg = cyclingWeight ? +cyclingWeight : (latest?.weight || 75);

      setLoadingCycling(true);
      setCyclingResult(null);
      const res = await fetch('/.netlify/functions/cycling-nutrition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocks:   ride.blocks,
          weightKg,
          ftpWatts: cyclingFtp ? +cyclingFtp : undefined,
          actual: {
            kcal:       ride.activity.calories,
            avgHR:      ride.activity.avgHR,
            maxHR:      ride.activity.maxHR,
            avgWatts:   ride.activity.avgWatts,
            distanceKm: ride.activity.distanceKm,
            name:       ride.activity.name,
            zoneSource: ride.zoneSource,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Fehler bei Ernährungsberechnung');
      setCyclingResult(data);
    } catch (err) {
      setCyclingError(err.message);
    } finally {
      setLoadingRideSync(false);
      setLoadingCycling(false);
    }
  };

  // ── Calculator ───────────────────────────────────────────────────────────────
  const calculateCalorieGoal = () => {
    const { gender, age, weight, height, activity, goal } = calculatorData;
    if (!age || !weight || !height) { alert('Bitte fülle alle Felder aus!'); return; }
    let bmr = gender === 'male'
      ? 10 * +weight + 6.25 * +height - 5 * +age + 5
      : 10 * +weight + 6.25 * +height - 5 * +age - 161;
    let tdee = bmr * +activity;
    if (goal === 'lose') tdee -= 500;
    else if (goal === 'gain') tdee += 500;
    setCalculatedGoal(Math.round(tdee));
    localStorage.setItem('calculator-data', JSON.stringify(calculatorData));
  };

  // ── Stats helpers ────────────────────────────────────────────────────────────
  // Rollierendes 7-Tage-Fenster, offset 0 = bis heute, -1 = die 7 Tage davor, ...
  const getWeekDays = (offset = 0) =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + offset * 7 - (6 - i));
      return toDateKey(d);
    });

  // offset: 0 = aktueller Monat, -1 = Vormonat, -2 = vorletzter Monat, ...
  const getMonthDays = (offset = 0) => {
    const now = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + offset;
    const isCurrentMonth = offset === 0;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lastDay = isCurrentMonth ? now.getDate() : daysInMonth;
    return Array.from({ length: lastDay }, (_, i) =>
      toDateKey(new Date(year, month, i + 1))
    );
  };

  const calcStats = (days) => {
    // Vergessene Tage (< 1500 kcal echte Einträge, außer heute) → Tagesziel als Wert.
    // Korrektureinträge (isAutoCorrection) werden automatisch per Backfill gesetzt und
    // hier nur zur Erkennung genutzt – der kcal-Wert steckt bereits in den meals.
    const restBase    = (kiResult?.kcalGoalRestDay > 0 ? kiResult.kcalGoalRestDay : null) || calorieGoal || 1800;
    // TDEE ohne Sport (BMR+NEAT+TEF) als Basis für die Defizit-Anzeige
    const tdeeNoSport = kiResult?.tdeeRestDay ? Math.round(kiResult.tdeeRestDay) : null;

    const tracked = days;
    if (tracked.length === 0) return null;

    const sums = tracked.reduce((acc, d) => {
      const meals        = history[d] || [];
      const hasCorrEntry = meals.some(m => m.isAutoCorrection);
      const kcalLogged   = meals.reduce((s, m) => s + (m.kcal || 0), 0);
      const realKcal     = hasCorrEntry ? meals.filter(m => !m.isAutoCorrection).reduce((s, m) => s + (m.kcal || 0), 0) : kcalLogged;
      const isToday_     = d === todayKey;
      const training     = trainingDays.find(t => t.date === d);
      const dayGoal      = capDailyGoal(restBase + tieredEatback(training));
      // Fallback display-only (no backfill entry yet, day < 1500)
      const useGoal      = !isToday_ && !hasCorrEntry && realKcal < 1500;
      const kcalEff      = useGoal ? dayGoal : kcalLogged;
      if (useGoal) {
        return { ...acc, kcal: acc.kcal + kcalEff, sport: acc.sport + (training?.totalCalories || 0) };
      }
      // Correction entries contribute only kcal (macros = 0 for untracked days)
      const mealSums = meals.reduce((a, m) => ({
        kcal:    a.kcal    + (m.kcal    || 0),
        protein: a.protein + (!m.isAutoCorrection ? (m.protein || 0) : 0),
        carbs:   a.carbs   + (!m.isAutoCorrection ? (m.carbs   || 0) : 0),
        fat:     a.fat     + (!m.isAutoCorrection ? (m.fat     || 0) : 0),
        fiber:   a.fiber   + (!m.isAutoCorrection ? (m.fiber   || 0) : 0),
      }), acc);
      return { ...mealSums, sport: acc.sport + (training?.totalCalories || 0) };
    }, { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sport: 0 });

    const n = tracked.length;
    const waterDays = days.filter(d => (waterHistory[d] || 0) > 0);
    const waterSum = waterDays.reduce((acc, d) => acc + (waterHistory[d] || 0), 0);

    const dayData = days.map(d => {
      const meals        = history[d] || [];
      const training     = trainingDays.find(t => t.date === d);
      const dayGoal      = capDailyGoal(restBase + tieredEatback(training));
      const kcalLogged   = Math.round(meals.reduce((a, m) => a + (m.kcal || 0), 0));
      const isToday_     = d === todayKey;
      const hasCorrEntry = meals.some(m => m.isAutoCorrection);
      const realKcal     = hasCorrEntry ? Math.round(meals.filter(m => !m.isAutoCorrection).reduce((s, m) => s + (m.kcal || 0), 0)) : kcalLogged;
      const useGoal      = !isToday_ && !hasCorrEntry && realKcal < 1500;
      const kcalDisplay  = useGoal ? dayGoal : kcalLogged;
      const sportKcal    = training?.totalCalories || 0;
      const net          = Math.round(kcalDisplay - sportKcal);
      const deficit      = tdeeNoSport !== null ? Math.round(tdeeNoSport - net) : null;
      return {
        date:        d,
        kcal:        kcalLogged,
        kcalDisplay,
        untracked:   hasCorrEntry || useGoal,
        protein: Math.round(meals.filter(m => !m.isAutoCorrection).reduce((a, m) => a + (m.protein || 0), 0)),
        carbs:   Math.round(meals.filter(m => !m.isAutoCorrection).reduce((a, m) => a + (m.carbs   || 0), 0)),
        fat:     Math.round(meals.filter(m => !m.isAutoCorrection).reduce((a, m) => a + (m.fat     || 0), 0)),
        fiber:   Math.round(meals.filter(m => !m.isAutoCorrection).reduce((a, m) => a + (m.fiber   || 0), 0)),
        water:   waterHistory[d] || 0,
        goal:    dayGoal,
        sport:   sportKcal,
        net,
        deficit,
      };
    });

    const maxKcal = Math.max(...dayData.map(d => Math.max(d.kcalDisplay || d.kcal, d.goal)), 1);
    // Heute ist noch nicht abgeschlossen (Essen/Sport ggf. noch nicht vollständig erfasst) →
    // aus Netto-/Defizit-Berechnungen ausschließen, sonst verzerrt der unvollständige Tag den Schnitt.
    const netDays      = dayData.filter(d => d.date !== todayKey);
    const deficitDays  = dayData.filter(d => d.deficit !== null && d.date !== todayKey);
    const deficitSum   = deficitDays.length ? Math.round(deficitDays.reduce((s, d) => s + d.deficit, 0)) : null;

    return {
      avg: {
        kcal: Math.round(sums.kcal / n),
        protein: Math.round(sums.protein / n),
        carbs: Math.round(sums.carbs / n),
        fat: Math.round(sums.fat / n),
        fiber: Math.round(sums.fiber / n),
        sport: Math.round(sums.sport / n),
        net: netDays.length ? Math.round(netDays.reduce((s, d) => s + d.net, 0) / netDays.length) : null,
        deficit: deficitDays.length ? Math.round(deficitSum / deficitDays.length) : null,
      },
      trackedDays: n,
      totalDays: days.length,
      avgWater: waterDays.length > 0 ? (waterSum / waterDays.length).toFixed(1) : '0.0',
      dayData,
      maxKcal,
      tdeeNoSport,
      deficitSum,
      deficitDaysCount: deficitDays.length,
    };
  };

  // ── Water UI ─────────────────────────────────────────────────────────────────
  const waterPct = Math.min((currentWater / 3) * 100, 100);
  const waterBarColor =
    currentWater >= 3 ? 'from-emerald-400 to-green-500' :
    currentWater >= 2 ? 'from-yellow-400 to-amber-400' :
    currentWater >= 1 ? 'from-orange-400 to-amber-500' :
    'from-red-400 to-orange-400';
  const waterStatusText =
    currentWater >= 3 ? '🎉 Idealziel erreicht!' :
    currentWater >= 2
      ? `✓ Minimum erreicht · Noch ${(3 - currentWater).toFixed(2).replace(/\.?0+$/, '')}L bis Ideal (3L)`
      : `Noch ${(2 - currentWater).toFixed(2).replace(/\.?0+$/, '')}L bis Minimum (2L)`;
  const waterStatusColor =
    currentWater >= 3 ? 'text-green-600' :
    currentWater >= 2 ? 'text-amber-600' :
    'text-orange-600';

  if (loadingInitial) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  const weekDays = getWeekDays(weekOffset);
  const monthDays = getMonthDays(monthOffset);
  const weekStats = calcStats(weekDays);
  const monthStats = calcStats(monthDays);

  // ── Health score label ───────────────────────────────────────────────────────
  const healthLabel = (s) =>
    ['', 'Sehr gesund', 'Gesund', 'Okay', 'Weniger gesund', 'Ungesund', 'Sehr ungesund'][s] || '';

  const healthColors = (s) =>
    s <= 2
      ? { bg: 'bg-green-50 border-green-200', circle: 'bg-gradient-to-br from-green-500 to-emerald-500', title: 'text-green-800', text: 'text-green-700', badge: 'bg-gradient-to-r from-green-500 to-emerald-500' }
      : s <= 4
      ? { bg: 'bg-yellow-50 border-yellow-200', circle: 'bg-gradient-to-br from-yellow-500 to-amber-500', title: 'text-yellow-800', text: 'text-yellow-700', badge: 'bg-gradient-to-r from-yellow-500 to-amber-500' }
      : { bg: 'bg-red-50 border-red-200', circle: 'bg-gradient-to-br from-red-500 to-rose-500', title: 'text-red-800', text: 'text-red-700', badge: 'bg-gradient-to-r from-red-500 to-rose-500' };

  // ── Claude Export ────────────────────────────────────────────────────────────
  const buildClaudeExport = (mode = 'data') => {
    const now = new Date();
    const days14 = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - 13 + i);
      return toDateKey(d);
    });

    // Ernährung letzte 14 Tage
    const nutritionLines = days14.map(dateKey => {
      const meals   = (history[dateKey] || []).filter(m => !m.isAutoCorrection);
      const strava  = trainingDays.find(t => t.date === dateKey);
      const kcal    = Math.round(meals.reduce((s, m) => s + (m.kcal    || 0), 0));
      const prot    = Math.round(meals.reduce((s, m) => s + (m.protein || 0), 0));
      const carbs   = Math.round(meals.reduce((s, m) => s + (m.carbs   || 0), 0));
      const fat     = Math.round(meals.reduce((s, m) => s + (m.fat     || 0), 0));
      const label   = new Date(dateKey + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
      const trainStr = strava ? ` | Training: ${strava.totalCalories} kcal, ${strava.totalMinutes} min (${(strava.types||[]).join('+')})` : '';
      return kcal > 0
        ? `${label}: ${kcal} kcal | P ${prot}g | C ${carbs}g | F ${fat}g${trainStr}`
        : `${label}: nicht erfasst${trainStr}`;
    }).join('\n');

    // Körperdaten (letzte 8 Messungen)
    const bodyLines = [...bodyMeasurements].slice(-8).map(m =>
      `${m.date}: ${m.weight ?? '-'} kg | KFA ${m.fatPct ?? '-'}% | Muskeln ${m.musclePct ?? '-'}% | Viszeral ${m.visceralFat ?? '-'}`
    ).join('\n') || 'Keine Körperdaten vorhanden';

    // Ziele
    const goalLine = bodyGoals.weight
      ? `Ziel: ${bodyGoals.weight} kg | KFA ${bodyGoals.fatPct ?? '-'}% | Muskeln ${bodyGoals.musclePct ?? '-'}%`
      : 'Keine Körperziele definiert';

    // Makroziele
    const macroLine = kiResult?.macroGoalsRestDay
      ? `Ruhetag: ${capDailyGoal(kiResult.kcalGoalRestDay)} kcal (immer 2000) | P ${kiResult.macroGoalsRestDay.proteinG}g | C ${kiResult.macroGoalsRestDay.carbsG}g | F ${kiResult.macroGoalsRestDay.fatG}g
Trainingstag: ${kiResult.kcalGoalRestDay} kcal Basis + Strava-kcal inkl. tiered eat-back (Ziel begrenzt auf 2000–3000 kcal) | P 150g | C 200g | F 85g
Zone2/VO2max-Rad: | C 300g | F 85g`
      : `Kalorienziel: ${calorieGoal} kcal`;

    const header = mode === 'training'
      ? `Du bist mein persönlicher Fitness- und Ernährungscoach. Analysiere meine Daten der letzten 2 Wochen und optimiere meinen Trainings- und Ernährungsplan für die nächsten 4 Wochen.

Berücksichtige dabei:
- Mein primäres Ziel ist Fettreduktion bei Erhalt der Muskelmasse und Regenerationsfähigkeit
- Ich fahre hauptsächlich Radsport (Strava) mit gelegentlichem Kraft- und Lauftraining
- Ruhetag: immer 2000 kcal | Sporttage: Basis 1800 kcal + Strava-kcal inkl. tiered eat-back (VO2max→90%, >120min→88%, 60-120min→70%, ≤60min→55%)
- Tagesziel ist begrenzt auf 2000–3000 kcal (Untergrenze schützt Schlaf/Regeneration, Obergrenze deckelt Trainingstage)
- Strava-Kalorien werden pauschal um 20% nach unten korrigiert (Überschätzung)
- Tägliches Defizit soll 200–500 kcal bleiben (nie über 500!)
- RED-S-Risiko vermeiden: kein extremes Defizit an Intensivtagen

Erstelle einen konkreten Wochenplan mit:
1. Trainingsstruktur (Intensität, Dauer, Erholung)
2. Ernährungsstrategie pro Trainingstyp
3. Konkrete Mahlzeitenbeispiele
4. Anpassungen basierend auf den Trends in meinen Daten

`
      : `Hier sind meine aktuellen Fitness- und Ernährungsdaten der letzten 2 Wochen:\n\n`;

    return `${header}═══ KÖRPERDATEN ═══
${bodyLines}

${goalLine}

═══ KALORIE- & MAKROZIELE ═══
${macroLine}

═══ ERNÄHRUNG & TRAINING – LETZTE 14 TAGE ═══
${nutritionLines}

═══ STRAVA-TRAINING (letzte 14 Tage) ═══
${trainingDays.filter(d => {
  const diff = (now - new Date(d.date + 'T12:00:00')) / 86400000;
  return diff >= 0 && diff <= 14;
}).map(d => `${d.date}: ${d.totalCalories} kcal, ${d.totalMinutes} min, ${(d.types||[]).join('+')}`).join('\n') || 'Keine Strava-Daten'}`;
  };

  const shareWithClaude = async (mode = 'data') => {
    const text = buildClaudeExport(mode);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback: textarea-Trick
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setClaudeCopied(mode);
    setTimeout(() => setClaudeCopied(null), 3000);
    window.open('https://claude.ai/new', '_blank');
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 p-4 md:p-8 font-sans">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
        * { font-family: 'Outfit', sans-serif; }
        .mono { font-family: 'Space Mono', monospace; }
        .glass {
          background: rgba(255,255,255,0.7);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255,255,255,0.5);
        }
        .stat-card { transition: all 0.3s ease; }
        .stat-card:hover { transform: translateY(-2px); box-shadow: 0 8px 16px rgba(0,0,0,0.1); }
        .meal-card { animation: slideIn 0.4s ease-out forwards; opacity: 0; }
        @keyframes slideIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .input-glow:focus { box-shadow: 0 0 0 3px rgba(16,185,129,0.1); }
      `}</style>

      <div className="max-w-4xl mx-auto">

        {/* ── Header ── */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg">
              <Flame className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
              Kalorienzähler V2
            </h1>
          </div>
          <p className="text-slate-500 text-sm">KI-gestützte Nährwertanalyse mit Google Gemini (Kostenlos!)</p>
          <div className="flex gap-3 justify-center mt-4 flex-wrap">
            <button
              onClick={clearDay}
              className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium transition-colors"
            >
              Tag leeren
            </button>
            <button
              onClick={() => setShowCalculator(true)}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white text-sm font-medium transition-all shadow-md flex items-center gap-2"
            >
              <Calculator className="w-4 h-4" />
              Kalorienziel
            </button>
            <button
              onClick={() => { setMacroDraft({ ...macroGoals }); setShowMacroGoals(true); }}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white text-sm font-medium transition-all shadow-md flex items-center gap-2"
            >
              <Target className="w-4 h-4" />
              Makroziele
            </button>
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div className="glass rounded-2xl p-1.5 mb-5 shadow-md flex gap-1">
          {[
            { key: 'day',   icon: <Calendar  className="w-4 h-4" />, label: 'Tag'   },
            { key: 'week',  icon: <BarChart2  className="w-4 h-4" />, label: 'Woche' },
            { key: 'month', icon: <TrendingUp className="w-4 h-4" />, label: 'Monat' },
            { key: 'coach', icon: <Brain      className="w-4 h-4" />, label: 'Coach' },
            { key: 'rad',   icon: <Bike       className="w-4 h-4" />, label: 'Rad'   },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
                activeTab === tab.key
                  ? 'bg-white shadow-md text-emerald-700'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* DAY VIEW                                                             */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'day' && (
          <>
            {/* Date nav */}
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() => navigateDay(-1)}
                className="p-2.5 rounded-xl hover:bg-white/70 text-slate-600 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <div className="text-center">
                <h2 className="text-xl font-bold text-slate-800">{formatDisplayDate(selectedDate)}</h2>
                {!isToday && (
                  <button
                    onClick={() => setSelectedDate(todayKey)}
                    className="text-xs text-emerald-600 hover:underline mt-0.5"
                  >
                    → Zurück zu Heute
                  </button>
                )}
                {isToday && (
                  <p className="text-slate-400 text-xs mt-0.5">
                    {new Date().toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                )}
              </div>
              <button
                onClick={() => navigateDay(1)}
                disabled={isToday}
                className="p-2.5 rounded-xl hover:bg-white/70 text-slate-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* ── Preset buttons ── */}
            <div className="glass rounded-2xl p-4 mb-4 shadow-md">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wide">Tages-Typ</h3>
                <button
                  onClick={() => { setPresetDraft(JSON.parse(JSON.stringify(presets))); setEditingPresetKey('rest'); setShowPresetSettings(true); }}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                  title="Presets anpassen"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
              <div className="flex gap-2">
                {Object.entries(presets).map(([key, p]) => {
                  const isActive = activePreset === key;
                  return (
                    <button
                      key={key}
                      onClick={() => applyPreset(key)}
                      className={`flex-1 py-3 px-2 rounded-xl flex flex-col items-center gap-0.5 transition-all ${
                        isActive
                          ? 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-md scale-[1.02]'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-600 hover:scale-[1.01]'
                      }`}
                    >
                      <span className="text-xl">{p.emoji}</span>
                      <span className="text-xs font-bold leading-tight">{p.label}</span>
                      <span className={`text-xs mono font-medium ${isActive ? 'text-white/80' : 'text-slate-400'}`}>
                        {p.kcal} kcal
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Summary card */}
            {(() => {
              // Formel: Ruhetag immer 2000 kcal, Sporttag: Basis 1800 kcal + Strava-Kalorien (inkl. Abschlag)
              const dayStrava = trainingDays.find(d => d.date === selectedDate);
              const restBase = kiResult?.kcalGoalRestDay || 1800;
              const effectiveGoal = isToday ? effectiveTodayGoal : capDailyGoal(restBase + tieredEatback(dayStrava));
              const isOver = totals.kcal > effectiveGoal;
              return (
            <div className="glass rounded-3xl p-6 mb-4 shadow-xl">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">Übersicht</h2>
                  {isToday && (
                    <p className={`mt-1 flex items-center gap-1 text-xs font-semibold ${
                      todayTrainingBonus > 0 ? 'text-emerald-600' : 'text-slate-400'
                    }`}>
                      <Sparkles className="w-3 h-3" />
                      {todayTrainingBonus > 0
                        ? `Trainingstag · +${todayTrainingBonus} kcal einberechnet`
                        : (kiResult ? 'Ruhetag-Ziel aktiv' : 'Kalorienziel aus Einstellungen')}
                    </p>
                  )}
                </div>
                <div className="flex items-end gap-4">
                  {/* Remaining – most important, largest */}
                  <div className="text-right">
                    <p className={`text-5xl font-bold mono ${isOver ? 'bg-gradient-to-r from-red-500 to-rose-600 bg-clip-text text-transparent' : 'bg-gradient-to-r from-emerald-400 to-teal-500 bg-clip-text text-transparent'}`}>
                      {isOver ? `+${Math.round(totals.kcal - effectiveGoal)}` : Math.round(effectiveGoal - totals.kcal)}
                    </p>
                    <p className={`text-xs font-semibold uppercase tracking-wide ${isOver ? 'text-red-400' : 'text-emerald-500'}`}>
                      {isOver ? 'über ziel' : 'verbleibend'}
                    </p>
                  </div>
                  <div className="w-px h-14 bg-slate-200 self-center" />
                  {/* Consumed + Goal stacked on right */}
                  <div className="text-right">
                    <p className="text-2xl font-bold mono bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
                      {Math.round(totals.kcal)}
                    </p>
                    <p className="text-slate-400 text-xs font-semibold uppercase tracking-wide">verbraucht</p>
                    <p className="text-slate-400 text-xs mt-2">Tagesziel <span className="font-bold text-slate-600">{effectiveGoal}</span> kcal</p>
                  </div>
                </div>
              </div>

              {/* Auto-adjustment info strip */}
              {(() => {
                const dayBonus = isToday ? todayTrainingBonus : tieredEatback(dayStrava);
                const dayBurn  = dayStrava?.totalCalories || 0;
                if (dayBonus <= 0) return null;
                return (
                  <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-700">
                    <Activity className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="leading-tight">
                      Trainingstag erkannt · Ziel automatisch um +{dayBonus} kcal erhöht
                      {dayBurn > 0 && ` (${dayBurn} kcal verbrannt)`}
                    </span>
                  </div>
                );
              })()}

              {/* Progress bar */}
              <div className="mb-5">
                <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r transition-all duration-500 ease-out rounded-full ${
                      isOver ? 'from-red-500 to-rose-500' : 'from-emerald-500 to-teal-500'
                    }`}
                    style={{ width: `${Math.min((totals.kcal / effectiveGoal) * 100, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1.5">
                  <span className="text-xs text-slate-500">
                    {isOver
                      ? `${Math.round(totals.kcal - effectiveGoal)} kcal über Ziel`
                      : `${Math.round(effectiveGoal - totals.kcal)} kcal verbleibend`}
                  </span>
                  <span className="text-xs text-slate-500">
                    Ziel: {effectiveGoal} kcal
                    {isToday && todayTrainingBonus > 0 && (
                      <span className="text-emerald-600 ml-1">(+{todayTrainingBonus} Training)</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Meal suggestion button — only today, only when not over goal */}
              {isToday && !isOver && (
                <button
                  onClick={() => {
                    const remKcal    = Math.max(0, effectiveGoal - totals.kcal);
                    const remProtein = Math.max(0, macroGoalGrams.protein - totals.protein);
                    const remCarbs   = Math.max(0, macroGoalGrams.carbs   - totals.carbs);
                    const remFat     = Math.max(0, macroGoalGrams.fat     - totals.fat);
                    const remFiber   = Math.max(0, macroGoalGrams.fiber   - totals.fiber);
                    suggestMeals(remKcal, { protein: remProtein, carbs: remCarbs, fat: remFat, fiber: remFiber });
                  }}
                  className="w-full mb-5 flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-600 text-white font-semibold text-sm shadow-md hover:shadow-lg hover:scale-[1.01] active:scale-[0.99] transition-all"
                >
                  <Sparkles className="w-4 h-4" />
                  Mahlzeit vorschlagen · noch {Math.round(Math.max(0, effectiveGoal - totals.kcal))} kcal verbleibend
                </button>
              )}

              {/* Macro cards with progress */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Protein',       value: totals.protein, goal: macroGoalGrams.protein, bar: 'bg-blue-500',   from: 'from-blue-50',   to: 'to-blue-100',   border: 'border-blue-200',   color: 'text-blue-600',   num: 'text-blue-900',   barBg: 'bg-blue-200'   },
                  { label: 'Kohlenhydrate', value: totals.carbs,   goal: macroGoalGrams.carbs,   bar: 'bg-amber-500',  from: 'from-amber-50',  to: 'to-amber-100',  border: 'border-amber-200',  color: 'text-amber-600',  num: 'text-amber-900',  barBg: 'bg-amber-200'  },
                  { label: 'Fett',          value: totals.fat,     goal: macroGoalGrams.fat,     bar: 'bg-purple-500', from: 'from-purple-50', to: 'to-purple-100', border: 'border-purple-200', color: 'text-purple-600', num: 'text-purple-900', barBg: 'bg-purple-200' },
                  { label: 'Ballaststoffe', value: totals.fiber,   goal: macroGoalGrams.fiber,   bar: 'bg-green-500',  from: 'from-green-50',  to: 'to-green-100',  border: 'border-green-200',  color: 'text-green-600',  num: 'text-green-900',  barBg: 'bg-green-200'  },
                ].map(s => {
                  const pct = Math.min((s.value / s.goal) * 100, 100);
                  const reached = s.value >= s.goal;
                  const remaining = Math.round(s.goal - s.value);
                  return (
                    <div key={s.label} className={`stat-card bg-gradient-to-br ${s.from} ${s.to} rounded-xl p-4 border ${s.border}`}>
                      <div className="flex items-center justify-between mb-1">
                        <p className={`${s.color} text-xs font-semibold uppercase tracking-wide`}>{s.label}</p>
                        {reached
                          ? <span className="text-xs text-green-600 font-bold">✓</span>
                          : <span className={`text-xs ${s.color} opacity-70`}>-{remaining}g</span>
                        }
                      </div>
                      <p className={`text-2xl font-bold ${s.num} mono`}>{Math.round(s.value)}g</p>
                      <p className={`text-xs ${s.color} opacity-60 mb-2`}>Ziel: {s.goal}g</p>
                      <div className={`h-1.5 ${s.barBg} rounded-full overflow-hidden`}>
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${reached ? 'bg-green-500' : s.bar}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            );
            })()}

            {/* ── Netto-Kalorien & Defizit ── */}
            {(() => {
              const dayStrava   = trainingDays.find(d => d.date === selectedDate);
              const sportKcal   = dayStrava?.totalCalories || 0;
              const netKcal     = Math.round(totals.kcal - sportKcal);
              const tdeeNoSport = kiResult?.tdeeRestDay ? Math.round(kiResult.tdeeRestDay) : null;
              const deficit     = tdeeNoSport !== null ? Math.round(tdeeNoSport - netKcal) : null;
              const REFERENCE_DEFICIT = 200;
              const deficitTone = deficit === null
                ? { bg: 'bg-slate-50 border-slate-200', text: 'text-slate-600', num: 'text-slate-700' }
                : deficit >= REFERENCE_DEFICIT
                  ? { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-600', num: 'text-emerald-700' }
                  : deficit > 0
                    ? { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-600', num: 'text-amber-700' }
                    : { bg: 'bg-rose-50 border-rose-200', text: 'text-rose-600', num: 'text-rose-700' };
              return (
                <div className="glass rounded-3xl p-5 mb-4 shadow-xl">
                  <h3 className="text-base font-bold text-slate-700 mb-4 flex items-center gap-2">
                    <Flame className="w-4 h-4 text-rose-500" /> Netto-Kalorien & Defizit
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
                      <p className="text-xs text-slate-500 mb-1">Netto-Kalorien</p>
                      <p className="text-2xl font-bold text-slate-700 mono">{netKcal}</p>
                      <p className="text-xs text-slate-400 mt-1">{Math.round(totals.kcal)} Essen − {sportKcal} Sport</p>
                    </div>
                    <div className={`border rounded-xl p-4 text-center ${deficitTone.bg}`}>
                      <p className={`text-xs mb-1 ${deficitTone.text}`}>{deficit === null ? 'Defizit' : deficit >= 0 ? 'Defizit' : 'Überschuss'}</p>
                      <p className={`text-2xl font-bold mono ${deficitTone.num}`}>
                        {deficit === null ? '–' : `${deficit >= 0 ? '−' : '+'}${Math.abs(deficit)}`}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        {tdeeNoSport !== null ? `TDEE ${tdeeNoSport} − Netto ${netKcal} · Ziel ~${REFERENCE_DEFICIT} kcal` : 'TDEE ohne Sport nicht verfügbar'}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── Mikronährstoffe ── */}
            <div className="glass rounded-3xl p-5 mb-4 shadow-xl">
              <button
                onClick={() => setShowMicronutrients(v => !v)}
                className="w-full flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">🔬</span>
                  <h3 className="text-lg font-bold text-slate-800">Mikronährstoffe</h3>
                  {hasMicroData && (
                    <span className="text-xs bg-teal-100 text-teal-700 font-semibold px-2 py-0.5 rounded-full">
                      {MICRO_TARGETS.filter(t => totals[t.key] >= t.goal).length}/{MICRO_TARGETS.length} erreicht
                    </span>
                  )}
                  {!hasMicroData && currentMeals.length > 0 && (
                    <span className="text-xs bg-slate-100 text-slate-500 font-medium px-2 py-0.5 rounded-full">
                      Nur für neue Mahlzeiten
                    </span>
                  )}
                </div>
                <span className="text-slate-400 text-sm">{showMicronutrients ? '▲' : '▼'}</span>
              </button>

              {showMicronutrients && (
                <div className="mt-4">
                  {!hasMicroData && currentMeals.length > 0 && (
                    <p className="text-sm text-slate-500 mb-4 text-center">
                      Mikronährstoffe werden bei neu hinzugefügten Mahlzeiten automatisch erfasst.
                    </p>
                  )}
                  {currentMeals.length === 0 && (
                    <p className="text-sm text-slate-500 text-center">Noch keine Mahlzeiten heute.</p>
                  )}
                  <div className="grid grid-cols-1 gap-2">
                    {MICRO_TARGETS.map(t => {
                      const val  = totals[t.key] || 0;
                      const pct  = Math.min((val / t.goal) * 100, 100);
                      const done = val >= t.goal;
                      const statusColor = done
                        ? 'text-emerald-600' : pct >= 50
                        ? 'text-amber-600'   : 'text-red-500';
                      const barColor = done
                        ? 'bg-emerald-500' : pct >= 50
                        ? 'bg-amber-500'   : 'bg-red-400';
                      const precision = t.unit === 'µg' ? 1 : (t.goal < 20 ? 1 : 0);
                      return (
                        <div key={t.key} className="flex items-center gap-3">
                          <span className="text-base w-6 text-center flex-shrink-0">{t.emoji}</span>
                          <div className="w-24 flex-shrink-0">
                            <p className="text-xs font-semibold text-slate-700 truncate">{t.label}</p>
                          </div>
                          <div className="flex-1 relative">
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                          <div className="w-28 text-right flex-shrink-0">
                            <span className={`text-xs font-bold mono ${statusColor}`}>
                              {val.toFixed(precision)}{t.unit}
                            </span>
                            <span className="text-xs text-slate-400"> / {t.goal}{t.unit}</span>
                          </div>
                          {done && <span className="text-emerald-500 text-xs flex-shrink-0">✓</span>}
                          {!done && <span className="text-xs text-slate-400 flex-shrink-0 w-4"></span>}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-400 mt-3 text-center">
                    Referenzwerte: DGE (Deutsche Gesellschaft für Ernährung)
                  </p>
                </div>
              )}
            </div>

            {/* ── Water tracker ── */}
            <div className="glass rounded-3xl p-5 mb-4 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Droplets className="w-5 h-5 text-blue-500" />
                  <h3 className="text-lg font-bold text-slate-800">Wasserzähler</h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold mono text-blue-700">{currentWater.toFixed(1)} L</span>
                  <button
                    onClick={resetWater}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                    title="Zurücksetzen"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Progress bar with markers */}
              <div className="relative mb-2">
                <div className="h-5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${waterBarColor} transition-all duration-500 rounded-full`}
                    style={{ width: `${waterPct}%` }}
                  />
                </div>
                {/* 2L marker at 66.67% */}
                <div
                  className="absolute top-0 h-5 w-0.5 bg-slate-400 opacity-60"
                  style={{ left: '66.67%' }}
                />
              </div>

              {/* Scale labels */}
              <div className="flex justify-between text-xs text-slate-400 mb-3">
                <span>0</span>
                <span style={{ marginLeft: '60%' }} className="text-orange-500 font-semibold">2L Min.</span>
                <span className="text-green-500 font-semibold">3L Ideal</span>
              </div>

              <p className={`text-sm font-medium mb-4 ${waterStatusColor}`}>{waterStatusText}</p>

              {/* Quick-add buttons */}
              <div className="flex gap-2">
                {[0.25, 0.5, 1.0].map(amount => (
                  <button
                    key={amount}
                    onClick={() => addWater(amount)}
                    className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white text-sm font-semibold transition-all shadow-sm hover:shadow-md"
                  >
                    +{amount < 1 ? `${amount * 1000}ml` : `${amount}L`}
                  </button>
                ))}
                <button
                  onClick={() => addWater(-0.25)}
                  className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-semibold transition-colors"
                >
                  −250ml
                </button>
              </div>
            </div>

            {/* ── Body snapshot ── */}
            {bodyMeasurements.length > 0 && (() => {
              const latest = bodyMeasurements[bodyMeasurements.length - 1];
              const prev   = bodyMeasurements.length > 1 ? bodyMeasurements[bodyMeasurements.length - 2] : null;

              const trend = (key, lowerIsBetter = false) => {
                if (!prev || latest[key] == null || prev[key] == null) return null;
                const diff = latest[key] - prev[key];
                if (Math.abs(diff) < 0.05) return { arrow: '→', color: 'text-slate-400' };
                const good = lowerIsBetter ? diff < 0 : diff > 0;
                return { arrow: diff > 0 ? '↑' : '↓', color: good ? 'text-emerald-500' : 'text-rose-500' };
              };

              const goalDelta = (key, unit = '', lowerIsBetter = false) => {
                const val  = latest[key];
                const goal = bodyGoals[key];
                if (val == null || goal == null) return null;
                const diff = val - goal;
                if (Math.abs(diff) < 0.05) return { label: '✓', color: 'text-emerald-600' };
                const good = lowerIsBetter ? diff < 0 : diff > 0;
                return {
                  label: `${diff > 0 ? '+' : ''}${diff.toFixed(1)}${unit}`,
                  color: good ? 'text-emerald-600' : 'text-rose-500',
                };
              };

              const items = [
                { key: 'weight',      label: 'Gewicht',  unit: 'kg', lower: false },
                { key: 'fatPct',      label: 'Fett',     unit: '%',  lower: true  },
                { key: 'musclePct',   label: 'Muskeln',  unit: '%',  lower: false },
                { key: 'visceralFat', label: 'VF',       unit: '',   lower: true  },
              ].filter(i => latest[i.key] != null);

              if (items.length === 0) return null;

              return (
                <div className="glass rounded-2xl px-4 py-3 mb-4 shadow-md">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <Scale className="w-3.5 h-3.5" />
                      Körper · {new Date(latest.date + 'T12:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}
                    </div>
                    <button
                      onClick={() => setActiveTab('coach')}
                      className="text-xs text-violet-500 hover:text-violet-700 font-semibold transition-colors"
                    >
                      Details →
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {items.map(({ key, label, unit, lower }) => {
                      const t = trend(key, lower);
                      const d = goalDelta(key, unit, lower);
                      return (
                        <div key={key} className="text-center">
                          <p className="text-xs text-slate-400 font-medium mb-0.5">{label}</p>
                          <div className="flex items-center justify-center gap-0.5">
                            <span className="text-base font-bold text-slate-800 mono">{latest[key]}</span>
                            <span className="text-xs text-slate-400">{unit}</span>
                            {t && <span className={`text-xs font-bold ${t.color}`}>{t.arrow}</span>}
                          </div>
                          {d && <p className={`text-xs font-semibold ${d.color} mt-0.5`}>{d.label}</p>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* ── Meals list ── */}
            <div className="glass rounded-3xl p-6 mb-4 shadow-xl min-h-[180px] max-h-[500px] overflow-y-auto">
              <h3 className="text-xl font-bold text-slate-800 mb-4">
                Mahlzeiten{currentMeals.length > 0 && (
                  <span className="text-slate-400 text-base font-normal ml-2">({currentMeals.length})</span>
                )}
              </h3>

              {currentMeals.length === 0 ? (
                <div className="text-center py-10">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 mx-auto mb-3 flex items-center justify-center">
                    <Plus className="w-8 h-8 text-emerald-600" />
                  </div>
                  <p className="text-slate-500">Keine Mahlzeiten erfasst</p>
                  {isToday && <p className="text-slate-400 text-sm mt-1">Gib unten ein Lebensmittel ein</p>}
                </div>
              ) : (
                <div className="space-y-3">
                  {currentMeals.map((meal, index) => {
                    // ── Auto-correction entry (backfilled day goal) ──────────
                    if (meal.isAutoCorrection) {
                      return (
                        <div key={meal.id} className="meal-card bg-slate-50 rounded-xl border border-dashed border-slate-300"
                          style={{ animationDelay: `${index * 0.05}s` }}>
                          <div className="p-3 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">📊</span>
                              <div>
                                <p className="text-sm font-medium text-slate-500">{meal.name}</p>
                                <p className="text-xs text-slate-400">Automatisch · Tag nicht vollständig erfasst</p>
                              </div>
                            </div>
                            <span className="px-3 py-1 rounded-full bg-slate-200 text-slate-600 text-sm font-semibold mono">
                              {Math.round(meal.kcal)} kcal
                            </span>
                          </div>
                        </div>
                      );
                    }
                    // ── Regular meal card ────────────────────────────────────
                    const isExpanded = expandedMealId === meal.id;
                    const hc = healthColors(meal.healthScore);
                    return (
                      <div
                        key={meal.id}
                        className="meal-card bg-white rounded-xl shadow-sm hover:shadow-md transition-all border border-slate-100"
                        style={{ animationDelay: `${index * 0.05}s` }}
                      >
                        <div className="p-4 cursor-pointer" onClick={() => setExpandedMealId(isExpanded ? null : meal.id)}>
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-semibold mono text-slate-500">{meal.time}</span>
                                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                                  #{currentMeals.length - index}
                                </span>
                              </div>
                              <div className="flex items-center gap-2">
                                <h4 className="font-semibold text-slate-800">{meal.name}</h4>
                                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                              </div>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteMeal(meal.id); }}
                              className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className="px-3 py-1 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 text-white text-sm font-semibold mono">
                              {Math.round(meal.kcal)} kcal
                            </span>
                            {meal.healthScore && (
                              <span className={`px-3 py-1 rounded-full text-white text-sm font-bold flex items-center gap-1 ${hc.badge}`}>
                                <span className="text-xs">❤️</span>{meal.healthScore}/6
                              </span>
                            )}
                            <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-medium mono">P: {Math.round(meal.protein)}g</span>
                            <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-medium mono">K: {Math.round(meal.carbs)}g</span>
                            <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-700 text-xs font-medium mono">F: {Math.round(meal.fat)}g</span>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-slate-100 p-4 pt-3 bg-slate-50 rounded-b-xl">
                            {meal.healthExplanation && (
                              <div className={`rounded-xl p-4 mb-4 border ${hc.bg}`}>
                                <div className="flex items-start gap-3">
                                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl font-bold text-white flex-shrink-0 ${hc.circle}`}>
                                    {meal.healthScore}
                                  </div>
                                  <div>
                                    <h6 className={`font-bold text-sm mb-1 ${hc.title}`}>
                                      Gesundheits-Bewertung: {healthLabel(meal.healthScore)}
                                    </h6>
                                    <p className={`text-sm ${hc.text}`}>{meal.healthExplanation}</p>
                                  </div>
                                </div>
                              </div>
                            )}

                            {meal.components?.length > 0 && (
                              <>
                                <h5 className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Bestandteile</h5>
                                <div className="space-y-2">
                                  {meal.components.map((c, i) => (
                                    <div key={i} className="bg-white rounded-lg p-3 border border-slate-200">
                                      <div className="flex items-start justify-between mb-1">
                                        <div>
                                          <p className="font-medium text-slate-800 text-sm">{c.name}</p>
                                          <p className="text-xs text-slate-400">{c.amount}</p>
                                        </div>
                                        <span className="px-2 py-0.5 rounded-md bg-orange-100 text-orange-700 text-xs font-semibold mono">
                                          {Math.round(c.kcal)} kcal
                                        </span>
                                      </div>
                                      <div className="flex flex-wrap gap-1">
                                        <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-600 text-xs mono">P: {Math.round(c.protein)}g</span>
                                        <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-600 text-xs mono">K: {Math.round(c.carbs)}g</span>
                                        <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-600 text-xs mono">F: {Math.round(c.fat)}g</span>
                                        <span className="px-2 py-0.5 rounded bg-green-50 text-green-600 text-xs mono">Bal: {Math.round(c.fiber)}g</span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input – only for today */}
            {isToday ? (
              <div className="glass rounded-3xl p-4 shadow-xl">
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="z.B. 2 Äpfel, 100g Haferflocken mit Milch, Chicken Burger..."
                    disabled={loading}
                    className="flex-1 px-5 py-4 rounded-2xl border-2 border-slate-200 focus:border-emerald-500 focus:outline-none input-glow disabled:opacity-50 text-slate-700 placeholder-slate-400"
                  />
                  <button
                    onClick={handleSubmit}
                    disabled={loading || !input.trim()}
                    className="px-6 py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-semibold disabled:opacity-50 transition-all shadow-lg flex items-center gap-2"
                  >
                    {loading
                      ? <><Loader2 className="w-5 h-5 animate-spin" />Analysiere...</>
                      : <><Send className="w-5 h-5" />Hinzufügen</>
                    }
                  </button>
                </div>
                {savedFlash && (
                  <p className="text-xs text-emerald-600 font-medium mt-2 text-center animate-pulse">
                    ✓ Gespeichert
                  </p>
                )}
                <p className="text-xs text-slate-500 mt-2 text-center">
                  KI-gestützte Analyse · Komplett kostenlos mit Google Gemini
                </p>
              </div>
            ) : (
              <p className="text-center text-slate-400 text-sm py-2">
                Vergangene Tage sind schreibgeschützt
              </p>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* WEEK / MONTH VIEW                                                    */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {(activeTab === 'week' || activeTab === 'month') && (() => {
          const isWeek = activeTab === 'week';
          const days = isWeek ? weekDays : monthDays;
          const stats = isWeek ? weekStats : monthStats;
          const offset    = isWeek ? weekOffset : monthOffset;
          const setOffset = isWeek ? setWeekOffset : setMonthOffset;
          const monthDate = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1);
          const title = isWeek
            ? (weekOffset === 0
                ? 'Letzte 7 Tage'
                : `${new Date(weekDays[0] + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} – ${new Date(weekDays[6] + 'T12:00:00').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}`)
            : monthDate.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

          return (
            <>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setOffset(o => o - 1)}
                    className="p-1.5 rounded-lg hover:bg-slate-200/60 text-slate-500 transition-colors"
                    title={isWeek ? 'Vorherige Woche' : 'Vorheriger Monat'}
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <h2 className="text-2xl font-bold text-slate-800">{title}</h2>
                  <button
                    onClick={() => setOffset(o => Math.min(0, o + 1))}
                    disabled={offset >= 0}
                    className="p-1.5 rounded-lg hover:bg-slate-200/60 text-slate-500 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    title={isWeek ? 'Nächste Woche' : 'Nächster Monat'}
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  {offset !== 0 && (
                    <button
                      onClick={() => setOffset(0)}
                      className="ml-1 text-xs font-semibold text-teal-600 hover:text-teal-700 underline"
                    >
                      Heute
                    </button>
                  )}
                </div>
                <button
                  onClick={exportPDF}
                  className="flex items-center gap-2 px-3 py-2 bg-teal-500 hover:bg-teal-600 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  14-Tage PDF
                </button>
              </div>

              {!stats ? (
                <div className="glass rounded-3xl p-12 shadow-xl text-center">
                  <p className="text-slate-500 text-lg">Noch keine Daten für diesen Zeitraum</p>
                  <p className="text-slate-400 text-sm mt-2">Tracke zuerst einige Mahlzeiten im Tages-Tab</p>
                </div>
              ) : (
                <>
                  {/* Average stats */}
                  <div className="glass rounded-3xl p-6 mb-4 shadow-xl">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-slate-800">Ø Durchschnitt pro Tag</h3>
                      <span className="text-sm text-slate-500 bg-slate-100 px-3 py-1 rounded-full">
                        {stats.trackedDays} / {stats.totalDays} Tage
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {/* Calories – takes full width on small, 1 col on md */}
                      <div className="col-span-2 md:col-span-1 bg-gradient-to-br from-orange-50 to-rose-50 border border-orange-200 rounded-xl p-4">
                        <p className="text-orange-600 text-xs font-semibold uppercase tracking-wide mb-1">Kalorien</p>
                        <p className="text-3xl font-bold mono text-orange-900">{stats.avg.kcal}</p>
                        <p className="text-xs text-orange-400 mt-1">kcal/Tag · Ziel: {calorieGoal}</p>
                        <div className="mt-2 h-1.5 bg-orange-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${stats.avg.kcal > calorieGoal ? 'bg-red-400' : 'bg-emerald-400'}`}
                            style={{ width: `${Math.min((stats.avg.kcal / calorieGoal) * 100, 100)}%` }}
                          />
                        </div>
                      </div>

                      {[
                        { label: 'Protein',       value: stats.avg.protein, goal: macroGoalGrams.protein, bar: 'bg-blue-400',   barBg: 'bg-blue-100',   from: 'from-blue-50',   to: 'to-blue-100',   border: 'border-blue-200',   color: 'text-blue-600',   num: 'text-blue-900'   },
                        { label: 'Kohlenhydrate', value: stats.avg.carbs,   goal: macroGoalGrams.carbs,   bar: 'bg-amber-400',  barBg: 'bg-amber-100',  from: 'from-amber-50',  to: 'to-amber-100',  border: 'border-amber-200',  color: 'text-amber-600',  num: 'text-amber-900'  },
                        { label: 'Fett',          value: stats.avg.fat,     goal: macroGoalGrams.fat,     bar: 'bg-purple-400', barBg: 'bg-purple-100', from: 'from-purple-50', to: 'to-purple-100', border: 'border-purple-200', color: 'text-purple-600', num: 'text-purple-900' },
                        { label: 'Ballaststoffe', value: stats.avg.fiber,   goal: macroGoalGrams.fiber,   bar: 'bg-green-400',  barBg: 'bg-green-100',  from: 'from-green-50',  to: 'to-green-100',  border: 'border-green-200',  color: 'text-green-600',  num: 'text-green-900'  },
                      ].map(s => {
                        const pct = Math.min((s.value / s.goal) * 100, 100);
                        const reached = s.value >= s.goal;
                        return (
                          <div key={s.label} className={`bg-gradient-to-br ${s.from} ${s.to} border ${s.border} rounded-xl p-4`}>
                            <div className="flex items-center justify-between mb-1">
                              <p className={`${s.color} text-xs font-semibold uppercase tracking-wide`}>{s.label}</p>
                              {reached
                                ? <span className="text-xs text-emerald-600 font-bold">✓</span>
                                : <span className={`text-xs ${s.color} opacity-70`}>-{s.goal - s.value}g</span>
                              }
                            </div>
                            <p className={`text-2xl font-bold mono ${s.num}`}>{s.value}g</p>
                            <p className={`text-xs ${s.color} opacity-60 mb-1.5`}>Ziel: {s.goal}g</p>
                            <div className={`h-1.5 ${s.barBg} rounded-full overflow-hidden`}>
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${reached ? 'bg-emerald-400' : s.bar}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}

                      {/* Water average */}
                      <div className="bg-gradient-to-br from-cyan-50 to-blue-50 border border-cyan-200 rounded-xl p-4">
                        <p className="text-cyan-600 text-xs font-semibold uppercase tracking-wide mb-1 flex items-center gap-1">
                          <Droplets className="w-3 h-3" /> Wasser
                        </p>
                        <p className="text-2xl font-bold mono text-cyan-900">{stats.avgWater} L</p>
                        <p className="text-xs text-cyan-400 mt-1">Ziel: 2–3L</p>
                      </div>

                      {/* Sport calories average */}
                      <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4">
                        <p className="text-emerald-600 text-xs font-semibold uppercase tracking-wide mb-1 flex items-center gap-1">
                          <Activity className="w-3 h-3" /> Sport
                        </p>
                        <p className="text-2xl font-bold mono text-emerald-900">{stats.avg.sport}</p>
                        <p className="text-xs text-emerald-500 mt-1">kcal/Tag verbrannt</p>
                      </div>

                      {/* Net calories average */}
                      <div className="bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 rounded-xl p-4">
                        <p className="text-slate-600 text-xs font-semibold uppercase tracking-wide mb-1">Netto-Kalorien</p>
                        <p className="text-2xl font-bold mono text-slate-800">{stats.avg.net ?? '–'}</p>
                        <p className="text-xs text-slate-400 mt-1">Ø Essen − Sport · ohne heute</p>
                      </div>

                      {/* Deficit – kumuliert über den Zeitraum */}
                      {(() => {
                        const sum = stats.deficitSum;
                        const avgD = stats.avg.deficit;
                        const tone = sum === null
                          ? { bg: 'from-slate-50 to-slate-100', border: 'border-slate-200', text: 'text-slate-600', num: 'text-slate-800' }
                          : sum >= 0
                            ? { bg: 'from-emerald-50 to-teal-50', border: 'border-emerald-200', text: 'text-emerald-600', num: 'text-emerald-900' }
                            : { bg: 'from-rose-50 to-red-50', border: 'border-rose-200', text: 'text-rose-600', num: 'text-rose-900' };
                        return (
                          <div className={`bg-gradient-to-br ${tone.bg} border ${tone.border} rounded-xl p-4`}>
                            <p className={`${tone.text} text-xs font-semibold uppercase tracking-wide mb-1`}>
                              {sum === null ? 'Defizit' : sum >= 0 ? 'Defizit (Zeitraum)' : 'Überschuss (Zeitraum)'}
                            </p>
                            <p className={`text-2xl font-bold mono ${tone.num}`}>
                              {sum === null ? '–' : `${sum >= 0 ? '−' : '+'}${Math.abs(sum)}`}
                            </p>
                            <p className={`text-xs ${tone.text} opacity-70 mt-1`}>
                              {sum === null ? 'TDEE n/a' : `Ø ${avgD >= 0 ? '−' : '+'}${Math.abs(avgD)}/Tag · Ziel ~200/Tag · ohne heute`}
                            </p>
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Bar chart */}
                  <div className="glass rounded-3xl p-6 shadow-xl">
                    <h3 className="text-lg font-bold text-slate-800 mb-1">Kalorien pro Tag</h3>
                    <p className="text-xs text-slate-400 mb-4">Klick auf einen Balken → Tagesdetails öffnen</p>

                    <div className="flex items-end gap-1" style={{ height: '140px' }}>
                      {stats.dayData.map((day) => {
                        const displayKcal = day.untracked ? (day.kcalDisplay || 0) : day.kcal;
                        const pct = displayKcal > 0 ? (displayKcal / stats.maxKcal) * 100 : 0;
                        const goalPct = (day.goal / stats.maxKcal) * 100;
                        const isOver = displayKcal > day.goal;
                        const isSel = day.date === selectedDate;

                        return (
                          <div
                            key={day.date}
                            className="flex-1 flex flex-col items-center gap-1 cursor-pointer group"
                            onClick={() => { setSelectedDate(day.date); setActiveTab('day'); }}
                          >
                            <div className="w-full relative flex flex-col justify-end" style={{ height: '120px' }}>
                              {/* Goal dashed line */}
                              <div
                                className="absolute left-0 right-0 border-t border-dashed border-slate-300 pointer-events-none"
                                style={{ bottom: `${goalPct}%` }}
                              />
                              {/* Bar */}
                              {displayKcal > 0 ? (
                                <div
                                  className={`w-full rounded-t-md transition-all group-hover:opacity-75 ${
                                    day.untracked
                                      ? 'bg-slate-300 opacity-50 border border-dashed border-slate-400'
                                      : isOver
                                        ? 'bg-gradient-to-t from-red-500 to-rose-400'
                                        : 'bg-gradient-to-t from-emerald-500 to-teal-400'
                                  } ${isSel ? 'ring-2 ring-offset-1 ring-slate-500' : ''}`}
                                  style={{ height: `${pct}%` }}
                                  title={day.untracked
                                    ? `Nicht erfasst · geschätzt ${displayKcal} kcal (+10%)${day.sport > 0 ? ` · Sport: ${day.sport} kcal` : ''}`
                                    : `${day.kcal} kcal (Ziel: ${day.goal} kcal)${day.sport > 0 ? ` · Sport: ${day.sport} kcal` : ''}`}
                                />
                              ) : (
                                <div className="w-full h-1 bg-slate-200 rounded-full" />
                              )}
                            </div>
                            <span
                              className="text-slate-500 text-center leading-tight select-none"
                              style={{ fontSize: isWeek ? '11px' : '9px' }}
                            >
                              {isWeek
                                ? new Date(day.date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short' })
                                : new Date(day.date + 'T12:00:00').getDate()
                              }
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Legend */}
                    <div className="flex items-center gap-4 mt-3 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <div className="w-8 h-0 border-t-2 border-dashed border-slate-400" />
                        <span className="text-xs text-slate-400">Ziel ({calorieGoal} kcal)</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm bg-emerald-400" />
                        <span className="text-xs text-slate-400">Im Ziel</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-sm bg-red-400" />
                        <span className="text-xs text-slate-400">Über Ziel</span>
                      </div>
                    </div>
                  </div>

                  {/* Sport calories per day */}
                  <div className="glass rounded-3xl p-6 shadow-xl mt-3">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Activity className="w-4 h-4 text-emerald-600" /> Sport-Kalorien pro Tag
                      </h3>
                      <span className="text-xs text-slate-400">Ø {stats.avg.sport} kcal/Tag</span>
                    </div>
                    <p className="text-xs text-slate-400 mb-4">verbrannte Kalorien laut Strava (inkl. −20% Korrektur)</p>

                    <div className="flex items-end gap-1" style={{ height: '90px' }}>
                      {(() => {
                        const maxSport = Math.max(...stats.dayData.map(d => d.sport || 0), 1);
                        return stats.dayData.map((day) => {
                          const pct = day.sport > 0 ? (day.sport / maxSport) * 100 : 0;
                          const isSel = day.date === selectedDate;
                          return (
                            <div
                              key={day.date}
                              className="flex-1 flex flex-col items-center gap-1 cursor-pointer group"
                              onClick={() => { setSelectedDate(day.date); setActiveTab('day'); }}
                            >
                              <div className="w-full relative flex flex-col justify-end" style={{ height: '70px' }}>
                                {day.sport > 0 ? (
                                  <div
                                    className={`w-full rounded-t-md transition-all group-hover:opacity-75 bg-gradient-to-t from-emerald-500 to-teal-400 ${isSel ? 'ring-2 ring-offset-1 ring-slate-500' : ''}`}
                                    style={{ height: `${pct}%` }}
                                    title={`${day.sport} kcal verbrannt`}
                                  />
                                ) : (
                                  <div className="w-full h-1 bg-slate-200 rounded-full" />
                                )}
                              </div>
                              <span
                                className="text-slate-500 text-center leading-tight select-none"
                                style={{ fontSize: isWeek ? '11px' : '9px' }}
                              >
                                {isWeek
                                  ? new Date(day.date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short' })
                                  : new Date(day.date + 'T12:00:00').getDate()
                                }
                              </span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>

                  {/* Deficit per day (TDEE ohne Sport − Netto-Kalorien). Heute ausgeschlossen (unvollständiger Tag). */}
                  {(() => {
                    const deficits = stats.dayData.filter(d => d.deficit !== null && d.date !== todayKey);
                    if (deficits.length === 0) return null;
                    const REFERENCE_DEFICIT = 200;
                    const maxD  = Math.max(...deficits.map(d => d.deficit), REFERENCE_DEFICIT, 0);
                    const minD  = Math.min(...deficits.map(d => d.deficit), 0);
                    const range = (maxD - minD) || 1;
                    const zeroPct = ((0 - minD) / range) * 100;
                    const refPct  = ((REFERENCE_DEFICIT - minD) / range) * 100;
                    const avgD    = stats.avg.deficit;
                    const sumD    = stats.deficitSum;
                    return (
                      <div className="glass rounded-3xl p-6 shadow-xl mt-3">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <Flame className="w-4 h-4 text-rose-500" /> Defizit pro Tag
                          </h3>
                          <span className="text-xs text-slate-400 text-right">
                            Σ {sumD !== null ? `${sumD >= 0 ? '−' : '+'}${Math.abs(sumD)}` : '–'} kcal · Ø {avgD !== null ? `${avgD >= 0 ? '−' : '+'}${Math.abs(avgD)}` : '–'}/Tag
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mb-4">TDEE ohne Sport − Netto-Kalorien (Essen − Sport) · gestrichelt = Ziel 200 kcal</p>

                        <div className="flex items-end gap-1 relative" style={{ height: '110px' }}>
                          <div
                            className="absolute left-0 right-0 border-t border-dashed border-emerald-400 pointer-events-none z-10"
                            style={{ bottom: `${refPct}%` }}
                          />
                          <div
                            className="absolute left-0 right-0 border-t border-slate-300 pointer-events-none"
                            style={{ bottom: `${zeroPct}%` }}
                          />
                          {stats.dayData.map((day) => {
                            const isToday_ = day.date === todayKey;
                            if (day.deficit === null || isToday_) {
                              return (
                                <div
                                  key={day.date}
                                  className="flex-1 relative cursor-pointer group"
                                  style={{ height: '100%' }}
                                  onClick={() => { setSelectedDate(day.date); setActiveTab('day'); }}
                                  title={isToday_ ? 'Heute läuft noch · nicht in Ø/Σ enthalten' : undefined}
                                >
                                  {isToday_ && (
                                    <div
                                      className="absolute w-full border-t border-dashed border-slate-300"
                                      style={{ bottom: `${zeroPct}%` }}
                                    />
                                  )}
                                </div>
                              );
                            }
                            const isSel = day.date === selectedDate;
                            const barPct = (Math.abs(day.deficit) / range) * 100;
                            const isPositive = day.deficit >= 0;
                            return (
                              <div
                                key={day.date}
                                className="flex-1 relative cursor-pointer group"
                                style={{ height: '100%' }}
                                onClick={() => { setSelectedDate(day.date); setActiveTab('day'); }}
                              >
                                <div
                                  className={`absolute w-full rounded-sm transition-all group-hover:opacity-75 ${
                                    isPositive ? 'bg-emerald-400' : 'bg-rose-400'
                                  } ${isSel ? 'ring-2 ring-offset-1 ring-slate-500' : ''}`}
                                  style={{
                                    height: `${barPct}%`,
                                    bottom: isPositive ? `${zeroPct}%` : `${zeroPct - barPct}%`,
                                  }}
                                  title={`${isPositive ? 'Defizit' : 'Überschuss'}: ${Math.abs(day.deficit)} kcal`}
                                />
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex gap-1 mt-1">
                          {stats.dayData.map(day => (
                            <span
                              key={day.date}
                              className="flex-1 text-center text-slate-400 select-none"
                              style={{ fontSize: isWeek ? '11px' : '9px' }}
                            >
                              {isWeek
                                ? new Date(day.date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short' })
                                : new Date(day.date + 'T12:00:00').getDate()}
                            </span>
                          ))}
                        </div>
                        <div className="flex items-center gap-4 mt-3 flex-wrap">
                          <div className="flex items-center gap-1.5">
                            <div className="w-8 h-0 border-t-2 border-dashed border-emerald-400" />
                            <span className="text-xs text-slate-400">Ziel ({REFERENCE_DEFICIT} kcal)</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-3 h-3 rounded-sm bg-emerald-400" />
                            <span className="text-xs text-slate-400">Defizit</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-3 h-3 rounded-sm bg-rose-400" />
                            <span className="text-xs text-slate-400">Überschuss</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Macro charts 2×2 ── */}
                  <div className="grid grid-cols-2 gap-3 mt-3">
                    {[
                      { key: 'protein', label: 'Protein',       goal: macroGoalGrams.protein, unit: 'g', barOn: 'bg-blue-500',   barOff: 'bg-blue-300',   goalLine: 'border-blue-400',   bg: 'bg-blue-50',   border: 'border-blue-200',   title: 'text-blue-700'   },
                      { key: 'carbs',   label: 'Kohlenhydrate', goal: macroGoalGrams.carbs,   unit: 'g', barOn: 'bg-amber-500',  barOff: 'bg-amber-300',  goalLine: 'border-amber-400',  bg: 'bg-amber-50',  border: 'border-amber-200',  title: 'text-amber-700'  },
                      { key: 'fat',     label: 'Fett',          goal: macroGoalGrams.fat,     unit: 'g', barOn: 'bg-purple-500', barOff: 'bg-purple-300', goalLine: 'border-purple-400', bg: 'bg-purple-50', border: 'border-purple-200', title: 'text-purple-700' },
                      { key: 'fiber',   label: 'Ballaststoffe', goal: macroGoalGrams.fiber,   unit: 'g', barOn: 'bg-green-500',  barOff: 'bg-green-300',  goalLine: 'border-green-400',  bg: 'bg-green-50',  border: 'border-green-200',  title: 'text-green-700'  },
                    ].map(macro => {
                      const maxVal = Math.max(...stats.dayData.map(d => d[macro.key] || 0), macro.goal, 1);
                      const goalPct = (macro.goal / maxVal) * 100;
                      return (
                        <div key={macro.key} className={`glass rounded-2xl p-4 border ${macro.border}`}>
                          <div className="flex items-center justify-between mb-3">
                            <h4 className={`text-sm font-bold ${macro.title}`}>{macro.label}</h4>
                            <span className="text-xs text-slate-400">Ziel: {macro.goal}{macro.unit}</span>
                          </div>
                          <div className="flex items-end gap-0.5" style={{ height: '64px' }}>
                            {stats.dayData.map(day => {
                              const val  = day[macro.key] || 0;
                              const pct  = val > 0 ? (val / maxVal) * 100 : 0;
                              const over = val > macro.goal;
                              return (
                                <div
                                  key={day.date}
                                  className="flex-1 relative flex flex-col justify-end cursor-pointer group"
                                  style={{ height: '56px' }}
                                  onClick={() => { setSelectedDate(day.date); setActiveTab('day'); }}
                                >
                                  {/* goal line */}
                                  <div
                                    className={`absolute left-0 right-0 border-t border-dashed ${macro.goalLine} opacity-60 pointer-events-none`}
                                    style={{ bottom: `${goalPct}%` }}
                                  />
                                  {val > 0 ? (
                                    <div
                                      className={`w-full rounded-t-sm transition-all group-hover:opacity-70 ${over ? 'bg-red-400' : macro.barOn}`}
                                      style={{ height: `${pct}%` }}
                                      title={`${val}${macro.unit}`}
                                    />
                                  ) : (
                                    <div className="w-full h-0.5 bg-slate-200 rounded-full" />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <div className="flex justify-between mt-1">
                            {stats.dayData.map((day, i) => (
                              <span
                                key={day.date}
                                className="flex-1 text-center text-slate-400 leading-tight select-none"
                                style={{ fontSize: isWeek ? '10px' : '8px' }}
                              >
                                {isWeek
                                  ? new Date(day.date + 'T12:00:00').toLocaleDateString('de-DE', { weekday: 'short' })
                                  : new Date(day.date + 'T12:00:00').getDate()
                                }
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          );
        })()}

        {/* ════════════════════════════════════════════════════════════════════ */}
        {/* COACH TAB                                                            */}
        {/* ════════════════════════════════════════════════════════════════════ */}
        {activeTab === 'coach' && (() => {
          const latest = bodyMeasurements.length > 0 ? bodyMeasurements[bodyMeasurements.length - 1] : null;
          const nutritionDays = Object.keys(history).length;

          const deltaColor = (current, goal, lowerIsBetter = false) => {
            if (current == null || goal == null) return 'text-slate-400';
            const diff = current - goal;
            if (Math.abs(diff) < 0.1) return 'text-emerald-600';
            const good = lowerIsBetter ? diff < 0 : diff > 0;
            return good ? 'text-emerald-600' : 'text-rose-500';
          };

          const deltaLabel = (current, goal, unit = '') => {
            if (current == null || goal == null) return '–';
            const diff = current - goal;
            if (Math.abs(diff) < 0.1) return '✓ Ziel erreicht';
            return `${diff > 0 ? '+' : ''}${diff.toFixed(1)}${unit} zum Ziel`;
          };

          const metrics = [
            { key: 'weight',      label: 'Gewicht',     unit: 'kg', icon: <Scale     className="w-4 h-4" />, lowerIsBetter: false, color: 'from-blue-50 to-blue-100 border-blue-200',       textColor: 'text-blue-700' },
            { key: 'fatPct',      label: 'Fettanteil',  unit: '%',  icon: <Flame      className="w-4 h-4" />, lowerIsBetter: true,  color: 'from-orange-50 to-orange-100 border-orange-200', textColor: 'text-orange-700' },
            { key: 'musclePct',   label: 'Muskeln',     unit: '%',  icon: <Dumbbell   className="w-4 h-4" />, lowerIsBetter: false, color: 'from-emerald-50 to-emerald-100 border-emerald-200', textColor: 'text-emerald-700' },
            { key: 'visceralFat', label: 'Viszerales Fett', unit: '', icon: <Target  className="w-4 h-4" />, lowerIsBetter: true,  color: 'from-rose-50 to-rose-100 border-rose-200',       textColor: 'text-rose-700' },
          ];

          const canRunCoach = nutritionDays >= 1 && bodyMeasurements.length >= 1;

          return (
            <>
              <h2 className="text-2xl font-bold text-slate-800 mb-4 text-center flex items-center justify-center gap-2">
                <Brain className="w-6 h-6 text-violet-600" /> KI Coach
              </h2>

              {/* ── Mit Claude teilen ── */}
              <div className="glass rounded-3xl p-4 mb-4 shadow-xl border border-amber-100">
                <p className="text-xs text-slate-500 mb-3 flex items-center gap-1.5">
                  <span className="text-amber-500">✦</span>
                  <span>Daten der letzten 14 Tage in Zwischenablage kopieren und Claude öffnen</span>
                </p>
                <div className="flex gap-2">
                  {/* Trainingsplan-Button (primär) */}
                  <button
                    onClick={() => shareWithClaude('training')}
                    className="flex-1 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-md
                      bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white"
                  >
                    {claudeCopied === 'training' ? (
                      <><Check className="w-4 h-4" /> Kopiert! Claude öffnet sich…</>
                    ) : (
                      <><Zap className="w-4 h-4" /> Trainingsplan optimieren</>
                    )}
                  </button>
                  {/* Rohdaten-Button (sekundär) */}
                  <button
                    onClick={() => shareWithClaude('data')}
                    title="Alle Daten kopieren (ohne Prompt)"
                    className="px-4 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 transition-all
                      bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
                  >
                    {claudeCopied === 'data' ? (
                      <><Check className="w-3.5 h-3.5" /> Kopiert!</>
                    ) : (
                      <><Upload className="w-3.5 h-3.5" /> Daten</>
                    )}
                  </button>
                </div>
                {(claudeCopied === 'training' || claudeCopied === 'data') && (
                  <p className="text-xs text-emerald-600 mt-2 text-center font-medium">
                    ✓ In Zwischenablage · Claude öffnet sich · einfach einfügen (⌘V)
                  </p>
                )}
              </div>

              {/* Body Dashboard */}
              <div className="glass rounded-3xl p-5 mb-4 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold text-slate-700">Körperdaten</h3>
                  <div className="flex items-center gap-2">
                    {/* Sync status badge */}
                    {syncStatus === 'syncing' && (
                      <span className="flex items-center gap-1 text-xs text-violet-500">
                        <Loader2 className="w-3 h-3 animate-spin" /> Sync…
                      </span>
                    )}
                    {syncStatus === 'ok' && (
                      <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold">
                        <Check className="w-3 h-3" /> Synchronisiert
                      </span>
                    )}
                    {syncStatus === 'error' && (
                      <span className="text-xs text-rose-500" title={syncError}>⚠ Sync-Fehler</span>
                    )}
                    {/* Last sync time */}
                    {lastSyncAt && syncStatus !== 'syncing' && (
                      <span className="text-xs text-slate-400">
                        {new Date(lastSyncAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    {/* Sync button */}
                    <button
                      onClick={() => syncBodyData(false)}
                      disabled={syncStatus === 'syncing'}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-100 hover:bg-violet-200 text-violet-700 text-xs font-semibold transition-colors disabled:opacity-50"
                      title="Daten von Blood Analytics laden"
                    >
                      <RefreshCw className="w-3 h-3" /> Sync
                    </button>
                  </div>
                </div>
                {/* Source label */}
                {latest?.source === 'blood-analytics' && (
                  <p className="text-xs text-slate-400 mb-3 flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-violet-400 inline-block" />
                    Quelle: Blood Analytics · {latest ? new Date(latest.date + 'T12:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                  </p>
                )}

                {!latest ? (
                  <div className="text-center py-6">
                    <Scale className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm">Noch keine Messung vorhanden</p>
                    <button
                      onClick={() => { setBodyDraft({ date: toDateKey(new Date()), weight: '', fatPct: '', musclePct: '', muscleMassKg: '', visceralFat: '', bmi: '' }); setBodyInputMode('manual'); setBodyScreenshotPreview(null); setShowBodyModal(true); }}
                      className="mt-3 text-xs text-violet-600 font-semibold hover:underline"
                    >
                      Erste Messung hinzufügen →
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {metrics.map(m => {
                      const val = latest[m.key];
                      const goal = bodyGoals[m.key];
                      return (
                        <div key={m.key} className={`bg-gradient-to-br ${m.color} border rounded-xl p-3`}>
                          <div className={`flex items-center gap-1.5 ${m.textColor} text-xs font-semibold mb-1`}>
                            {m.icon} {m.label}
                          </div>
                          <div className="flex items-end gap-1">
                            <span className="text-2xl font-bold text-slate-800 mono">
                              {val != null ? val : '–'}
                            </span>
                            {val != null && <span className="text-sm text-slate-500 mb-0.5">{m.unit}</span>}
                          </div>
                          {goal != null && (
                            <p className="text-xs mt-1">
                              <span className="text-slate-400">Ziel: {goal}{m.unit} · </span>
                              <span className={`font-semibold ${deltaColor(val, goal, m.lowerIsBetter)}`}>
                                {deltaLabel(val, goal, m.unit)}
                              </span>
                            </p>
                          )}
                          {goal == null && <p className="text-xs text-slate-400 mt-1">Kein Ziel gesetzt</p>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {latest?.bmi != null && (
                  <p className="text-center text-xs text-slate-400 mt-3">BMI: <span className="font-semibold text-slate-600">{latest.bmi}</span></p>
                )}
              </div>

              {/* Action row */}
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => { setBodyDraft({ date: toDateKey(new Date()), weight: '', fatPct: '', musclePct: '', muscleMassKg: '', visceralFat: '', bmi: '' }); setBodyInputMode('manual'); setBodyScreenshotPreview(null); setShowBodyModal(true); }}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-md transition-all"
                >
                  <Plus className="w-4 h-4" /> Messung
                </button>
                <button
                  onClick={() => { setBodyGoalsDraft({ weight: bodyGoals.weight ?? '', musclePct: bodyGoals.musclePct ?? '', fatPct: bodyGoals.fatPct ?? '', visceralFat: bodyGoals.visceralFat ?? '' }); setShowBodyGoalsModal(true); }}
                  className="flex-1 py-2.5 rounded-xl border-2 border-violet-300 text-violet-700 hover:bg-violet-50 text-sm font-semibold flex items-center justify-center gap-2 transition-all"
                >
                  <Target className="w-4 h-4" /> Zielwerte
                </button>
              </div>

              {/* ── KI-Intelligenz ── */}
              <div className="glass rounded-3xl p-5 mb-4 shadow-xl border border-violet-100">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md">
                      <Brain className="w-4 h-4 text-white" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">KI-Intelligenz</h3>
                      <p className="text-xs text-slate-400">Körper · Ernährung · Bewegung</p>
                    </div>
                  </div>
                  <button
                    onClick={runKiAdjust}
                    disabled={loadingKi || bodyMeasurements.length === 0}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold shadow-lg shadow-violet-500/20 transition-all"
                  >
                    {loadingKi
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analysiere…</>
                      : <><Sparkles className="w-3.5 h-3.5" /> Jetzt optimieren</>
                    }
                  </button>
                </div>

                {/* Training summary strip */}
                {trainingDays.length > 0 && (() => {
                  const last7 = trainingDays.filter(d => (Date.now() - new Date(d.date + 'T12:00:00').getTime()) / 86400000 <= 7);
                  return (
                    <div className="flex items-center gap-3 mb-3 px-3 py-2 bg-slate-50 rounded-xl text-xs text-slate-500">
                      <Activity className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />
                      <span>
                        <span className="font-semibold text-slate-700">{last7.length} Trainingstage</span> letzte 7 Tage ·{' '}
                        {last7.reduce((s, d) => s + d.totalCalories, 0)} kcal verbrannt ·{' '}
                        {trainingSyncAt ? `Sync ${new Date(trainingSyncAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : ''}
                        <button onClick={() => syncTrainingData(false)} className="ml-2 text-violet-500 hover:underline">↻</button>
                      </span>
                    </div>
                  );
                })()}

                {/* Training sync error */}
                {trainingSyncError && (
                  <div className="flex items-start gap-2 mb-3 px-3 py-2 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                    <span className="flex-shrink-0 mt-0.5">⚠</span>
                    <span><span className="font-semibold">Training-Sync Fehler:</span> {trainingSyncError}</span>
                    <button onClick={() => setTrainingSyncError(null)} className="ml-auto flex-shrink-0 text-rose-400 hover:text-rose-600">✕</button>
                  </div>
                )}

                {/* No body data warning */}
                {bodyMeasurements.length === 0 && (
                  <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-2">
                    ⚠ Bitte erst Körperdaten synchronisieren oder Messung hinzufügen.
                  </p>
                )}

                {/* KI Error */}
                {kiError && (
                  <p className="text-xs text-rose-600 bg-rose-50 rounded-lg px-3 py-2 mb-2">⚠ {kiError}</p>
                )}

                {/* KI Result */}
                {kiResult && !loadingKi && (
                  <div className="space-y-3">
                    {/* RED-S Alert – prominent */}
                    {kiResult.redSRisk && (
                      <div className="bg-red-50 border-2 border-red-400 rounded-xl px-4 py-3 space-y-1.5">
                        <p className="text-sm font-bold text-red-700">🚨 RED-S Risiko erkannt</p>
                        <p className="text-xs text-red-600">Muskelabbau bei hoher Trainingsbelastung. Das Kaloriendefizit bleibt bei −300 kcal — Muskelschutz erfolgt über erhöhtes Protein.</p>
                        {kiResult.proteinMinG && (
                          <div className="flex items-center justify-between bg-red-100 rounded-lg px-3 py-2 mt-1">
                            <span className="text-xs font-semibold text-red-700">Protein-Ziel (automatisch erhöht)</span>
                            <span className="text-sm font-bold text-red-800">{kiResult.proteinMinG} g/Tag</span>
                          </div>
                        )}
                        <p className="text-xs text-red-500">{kiResult.proteinPerKg} g/kg Körpergewicht · Makroziele wurden automatisch angepasst</p>
                      </div>
                    )}

                    {/* Warnings */}
                    {kiResult.warnings?.length > 0 && (
                      <div className="space-y-1">
                        {kiResult.warnings.map((w, i) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            <span className="mt-0.5 flex-shrink-0">⚠</span><span>{w}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Day-type calorie targets */}
                    {kiResult.kcalGoalRestDay && (() => {
                      const base = kiResult.kcalGoalRestDay;
                      const restGoal = capDailyGoal(base);
                      const todayT = trainingDays.find(d => d.date === todayKey);
                      const todayBurn = todayT?.totalCalories || 0;
                      const todayEatback = tieredEatback(todayT);
                      const todayGoal = capDailyGoal(base + todayEatback);
                      return (
                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                            <p className="text-xs text-slate-500 mb-1">🛋️ Ruhetag</p>
                            <p className="text-xl font-bold text-slate-700">{restGoal}</p>
                            <p className="text-xs text-slate-400">kcal Basis</p>
                          </div>
                          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                            <p className="text-xs text-emerald-600 mb-1">🏃 Heute</p>
                            <p className="text-xl font-bold text-emerald-700">{todayGoal}</p>
                            <p className="text-xs text-emerald-500">
                              {todayBurn > 0 ? `${base} + ${todayEatback} (von ${todayBurn} Strava, ${Math.round(getEatbackFactor(todayT)*100)}%)` : `${restGoal} kcal · kein Training`}
                            </p>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Macros – fixed gram targets, shown per day type */}
                    {(kiResult.macroGoalsRestDay || kiResult.macroGoalsTrainDay) && (
                      <div className="space-y-1.5">
                        {[
                          { label: '🛋️ Ruhetag',     src: kiResult.macroGoalsRestDay  },
                          { label: '🏃 Trainingstag', src: kiResult.macroGoalsTrainDay },
                        ].filter(r => r.src).map(row => (
                          <div key={row.label} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                            <p className="text-xs font-semibold text-slate-500 mb-1.5">{row.label}</p>
                            <div className="grid grid-cols-4 gap-1.5">
                              {[
                                { label: 'Protein', value: row.src.proteinG, color: 'text-blue-700'   },
                                { label: 'Carbs',   value: row.src.carbsG,   color: 'text-amber-700'  },
                                { label: 'Fett',    value: row.src.fatG,     color: 'text-purple-700' },
                                { label: 'Faser',   value: row.src.fiberG,   color: 'text-green-700'  },
                              ].map(t => (
                                <div key={t.label} className="text-center">
                                  <p className={`text-sm font-bold ${t.color}`}>{t.value}g</p>
                                  <p className="text-xs text-slate-400">{t.label}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* BMR + NEAT + TEF transparency */}
                    {(kiResult.bmr || kiResult.tdeeRestDay) && (
                      <div className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2 space-y-1">
                        <p className="font-semibold text-slate-500 mb-1">Berechnung Tagesziel</p>
                        {kiResult.bmr   && <div className="flex justify-between"><span>Grundumsatz (BMR)</span><span className="font-medium text-slate-600">+{kiResult.bmr} kcal</span></div>}
                        {kiResult.neat  && <div className="flex justify-between"><span>Alltagsbewegung (NEAT)</span><span className="font-medium text-slate-600">+{kiResult.neat} kcal</span></div>}
                        {kiResult.tef   && <div className="flex justify-between"><span>Nahrungswärme (TEF)</span><span className="font-medium text-slate-600">+{kiResult.tef} kcal</span></div>}
                        {kiResult.deficitApplied !== undefined && <div className="flex justify-between"><span>Defizit{kiResult.deficitApplied === 0 ? ' (RED-S: Erhaltung)' : ''}</span><span className="font-medium text-slate-600">−{kiResult.deficitApplied} kcal</span></div>}
                        <div className="flex justify-between border-t border-slate-200 pt-1 mt-1">
                          <span className="font-semibold text-slate-600">Basis Ruhetag</span>
                          <span className="font-bold text-slate-700">{capDailyGoal(kiResult.kcalGoalRestDay)} kcal</span>
                        </div>
                        {kiResult.kcalGoalRestDay < MIN_DAILY_KCAL && (
                          <div className="flex justify-between text-amber-600">
                            <span>↳ Sicherheits-Minimum angehoben</span>
                            <span className="font-medium">{kiResult.kcalGoalRestDay} → {MIN_DAILY_KCAL}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-emerald-600">
                          <span>+ Strava-Kalorien (live)</span>
                          <span className="font-medium">= {effectiveTodayGoal} kcal heute</span>
                        </div>
                      </div>
                    )}

                    {/* Stats row */}
                    <div className="flex gap-2 text-xs text-slate-500">
                      {kiResult.weeklyDeficit && (
                        <span className="flex-1 text-center bg-slate-50 rounded-lg py-1.5 px-2">
                          Defizit <span className="font-semibold text-slate-700">{kiResult.weeklyDeficit} kcal/Wo</span>
                        </span>
                      )}
                      {kiResult.estimatedWeeksToGoal && (
                        <span className="flex-1 text-center bg-slate-50 rounded-lg py-1.5 px-2">
                          ~<span className="font-semibold text-slate-700">{kiResult.estimatedWeeksToGoal} Wochen</span> bis Ziel
                        </span>
                      )}
                      {false && kiResult.trainDayBonus > 0 && (
                        <span className="flex-1 text-center bg-emerald-50 rounded-lg py-1.5 px-2 text-emerald-700">
                          +<span className="font-semibold">{kiResult.trainDayBonus}</span> kcal Trainingstag
                        </span>
                      )}
                    </div>

                    {/* Reason */}
                    {kiResult.adjustmentReason && (
                      <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2 leading-relaxed">
                        💡 {kiResult.adjustmentReason}
                      </p>
                    )}

                    <p className="text-xs text-slate-400 text-right">
                      ✓ Ziele wurden automatisch angepasst · {kiResult.analyzedAt ? new Date(kiResult.analyzedAt).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                    </p>
                  </div>
                )}

                {/* Placeholder if no result yet */}
                {!kiResult && !loadingKi && bodyMeasurements.length > 0 && (
                  <p className="text-xs text-slate-400 text-center py-2">
                    Drücke „Jetzt optimieren" um Kalorien- und Makroziele KI-gestützt anzupassen.
                  </p>
                )}
              </div>

              {/* Measurement history */}
              {bodyMeasurements.length > 0 && (
                <div className="glass rounded-2xl p-4 mb-4 shadow-md">
                  <button
                    onClick={() => setShowBodyHistory(!showBodyHistory)}
                    className="w-full flex items-center justify-between text-sm font-semibold text-slate-700"
                  >
                    <span>Verlauf ({bodyMeasurements.length} Messungen)</span>
                    <ChevronDown className={`w-4 h-4 transition-transform ${showBodyHistory ? 'rotate-180' : ''}`} />
                  </button>
                  {showBodyHistory && (
                    <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                      {[...bodyMeasurements].reverse().slice(0, 10).map((m, i) => (
                        <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
                          <span className="text-xs font-medium text-slate-600">
                            {new Date(m.date + 'T12:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })}
                          </span>
                          <div className="flex gap-2 text-xs text-slate-500">
                            {m.weight      != null && <span className="bg-blue-50   text-blue-700   px-2 py-0.5 rounded-full">{m.weight}kg</span>}
                            {m.fatPct      != null && <span className="bg-orange-50 text-orange-700 px-2 py-0.5 rounded-full">{m.fatPct}%</span>}
                            {m.musclePct   != null && <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">{m.musclePct}% M</span>}
                            {m.visceralFat != null && <span className="bg-rose-50   text-rose-700   px-2 py-0.5 rounded-full">VF {m.visceralFat}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* AI Coach */}
              <div className="glass rounded-3xl p-5 shadow-xl">
                <div className="flex items-center gap-2 mb-3">
                  <Brain className="w-5 h-5 text-violet-600" />
                  <h3 className="text-base font-bold text-slate-700">KI-Analyse</h3>
                </div>

                {!canRunCoach && (
                  <p className="text-xs text-slate-400 mb-3">
                    Mindestens 1 Tag Ernährungsdaten und 1 Körpermessung erforderlich.
                  </p>
                )}

                <button
                  onClick={runCoachAnalysis}
                  disabled={!canRunCoach || loadingCoach}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loadingCoach
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Analysiere...</>
                    : <><Brain className="w-4 h-4" /> Analyse starten</>
                  }
                </button>

                {coachAnalysis && (
                  <div className="mt-4 space-y-3">
                    <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
                      <p className="text-sm text-violet-900 leading-relaxed">{coachAnalysis.summary}</p>
                    </div>
                    <div className="space-y-2">
                      {coachAnalysis.recommendations?.map((rec, i) => {
                        const colors = {
                          high:   'border-l-rose-400   bg-rose-50   text-rose-800',
                          medium: 'border-l-amber-400  bg-amber-50  text-amber-800',
                          low:    'border-l-emerald-400 bg-emerald-50 text-emerald-800',
                        };
                        const cls = colors[rec.priority] || colors.medium;
                        return (
                          <div key={i} className={`border-l-4 rounded-r-xl p-3 ${cls}`}>
                            <p className="font-semibold text-sm">{rec.title}</p>
                            <p className="text-xs mt-1 leading-relaxed opacity-80">{rec.detail}</p>
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-xs text-slate-400 text-right">Analyse vom {coachAnalysis.generatedAt}</p>
                  </div>
                )}
              </div>

              {/* ── Coach Chat ── */}
              <div className="glass rounded-3xl shadow-xl overflow-hidden">
                {/* Header */}
                <div className="bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Brain className="w-5 h-5 text-white" />
                    <h3 className="text-white font-bold text-base">Coach Chat</h3>
                    <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded-full">Zugriff auf alle Daten</span>
                  </div>
                  {chatMessages.length > 0 && (
                    <button
                      onClick={() => setChatMessages([])}
                      className="text-white/60 hover:text-white text-xs transition-colors"
                    >
                      Leeren
                    </button>
                  )}
                </div>

                {/* Messages */}
                <div className="px-4 py-3 max-h-[420px] overflow-y-auto space-y-3 bg-slate-50/50">
                  {chatMessages.length === 0 && (
                    <div className="py-6 text-center">
                      <p className="text-slate-500 text-sm mb-4">Frag deinen Coach – er kennt alle deine Daten.</p>
                      <div className="flex flex-wrap gap-2 justify-center">
                        {[
                          'Wie läuft mein Fortschritt?',
                          'Was sollte ich heute essen?',
                          'Analysiere meine letzte Woche',
                          'Bin ich im Kaloriendefizit?',
                        ].map(q => (
                          <button
                            key={q}
                            onClick={() => sendChatMessage(q)}
                            className="text-xs bg-white border border-violet-200 text-violet-700 hover:bg-violet-50 rounded-full px-3 py-1.5 transition-colors shadow-sm"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {chatMessages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                        msg.role === 'user'
                          ? 'bg-gradient-to-br from-violet-500 to-indigo-500 text-white rounded-br-sm'
                          : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'
                      }`}>
                        {msg.role === 'assistant' && (
                          <div className="flex items-center gap-1.5 mb-1">
                            <Brain className="w-3 h-3 text-violet-500" />
                            <span className="text-xs font-semibold text-violet-600">Coach</span>
                          </div>
                        )}
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  ))}

                  {loadingChat && (
                    <div className="flex justify-start">
                      <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-2">
                          <Brain className="w-3 h-3 text-violet-500" />
                          <span className="text-xs text-slate-400">Coach tippt</span>
                          <div className="flex gap-0.5">
                            {[0,1,2].map(d => (
                              <div key={d} className="w-1.5 h-1.5 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: `${d*150}ms` }} />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Input */}
                <div className="px-4 py-3 border-t border-slate-200 bg-white">
                  <div className="flex gap-2 items-end">
                    <textarea
                      value={chatInput}
                      onChange={e => setChatInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
                      placeholder="Stell deinem Coach eine Frage..."
                      rows={1}
                      className="flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400 focus:border-transparent max-h-28 overflow-auto"
                      style={{ lineHeight: '1.4' }}
                    />
                    <button
                      onClick={() => sendChatMessage()}
                      disabled={!chatInput.trim() || loadingChat}
                      className="flex-shrink-0 w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 text-white flex items-center justify-center shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {loadingChat ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mt-1.5 text-center">Enter zum Senden · Shift+Enter für neue Zeile</p>
                </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* RAD NUTRITION TAB                                                          */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'rad' && (() => {
        const zones = [
          { key: 'Z1', label: 'Zone 1', sub: 'Regeneration' },
          { key: 'Z2', label: 'Zone 2', sub: 'Grundlage' },
          { key: 'Z3', label: 'Zone 3', sub: 'Tempo' },
          { key: 'Z4', label: 'Zone 4', sub: 'Schwelle' },
          { key: 'Z5', label: 'Zone 5', sub: 'VO₂max' },
          { key: 'Z6', label: 'Zone 6', sub: 'Sprint' },
        ];
        const totalMin = cyclingBlocks.reduce((s, b) => s + (Number(b.minutes) || 0), 0);
        const MacroChip = ({ label, value, unit = 'g', color }) => (
          <div className={`flex flex-col items-center px-3 py-2 rounded-xl ${color}`}>
            <span className="text-lg font-bold">{value}{unit}</span>
            <span className="text-xs opacity-70">{label}</span>
          </div>
        );
        const NutritionCard = ({ title, icon, timing, carbsG, proteinG, fatG, examples, accent }) => (
          <div className={`glass rounded-2xl p-4 mb-3 border-l-4 ${accent}`}>
            <div className="flex items-center gap-2 mb-1">
              {icon}
              <span className="font-bold text-slate-800">{title}</span>
              {timing && <span className="ml-auto text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{timing}</span>}
            </div>
            <div className="flex gap-2 mt-2 mb-2">
              <MacroChip label="Carbs"   value={carbsG}   color="bg-amber-50 text-amber-700" />
              <MacroChip label="Protein" value={proteinG} color="bg-blue-50 text-blue-700" />
              <MacroChip label="Fett"    value={fatG}     color="bg-rose-50 text-rose-700" />
            </div>
            {examples && <p className="text-xs text-slate-500 mt-1 leading-relaxed">💡 {examples}</p>}
          </div>
        );
        return (
          <div className="px-1">
            <h2 className="text-2xl font-bold text-slate-800 mb-1 text-center flex items-center justify-center gap-2">
              <Bike className="w-6 h-6 text-emerald-600" /> Rad-Ernährung
            </h2>
            <p className="text-center text-sm text-slate-400 mb-5">Optimale Nutrition vor · während · nach der Einheit</p>

            {/* Block Builder */}
            <div className="glass rounded-3xl p-5 mb-4 shadow-xl">
              <h3 className="font-bold text-slate-700 mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" /> Trainingsblöcke
              </h3>
              <div className="space-y-2 mb-3">
                {cyclingBlocks.map((block, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={block.zone}
                      onChange={e => setCyclingBlocks(prev => prev.map((b, j) => j === i ? { ...b, zone: e.target.value } : b))}
                      className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    >
                      {zones.map(z => (
                        <option key={z.key} value={z.key}>{z.label} – {z.sub}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1 bg-slate-100 rounded-xl px-3 py-2">
                      <input
                        type="number"
                        min="1"
                        max="600"
                        value={block.minutes}
                        onChange={e => setCyclingBlocks(prev => prev.map((b, j) => j === i ? { ...b, minutes: +e.target.value } : b))}
                        className="w-14 bg-transparent text-sm font-semibold text-center focus:outline-none"
                      />
                      <span className="text-xs text-slate-500">min</span>
                    </div>
                    {cyclingBlocks.length > 1 && (
                      <button onClick={() => setCyclingBlocks(prev => prev.filter((_, j) => j !== i))}
                        className="p-2 text-slate-400 hover:text-rose-500 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={() => setCyclingBlocks(prev => [...prev, { zone: 'Z2', minutes: 30 }])}
                className="w-full py-2 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 text-sm hover:border-emerald-400 hover:text-emerald-500 transition-all flex items-center justify-center gap-1"
              >
                <Plus className="w-4 h-4" /> Block hinzufügen
              </button>

              {/* Summary + Gewicht + FTP */}
              <div className="flex items-center gap-3 mt-4 pt-4 border-t border-slate-100">
                <div className="flex-1 text-center">
                  <p className="text-2xl font-bold text-emerald-600">{totalMin}</p>
                  <p className="text-xs text-slate-400">Minuten gesamt</p>
                </div>
                <div className="w-px h-10 bg-slate-200" />
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">
                    Gewicht
                    {!cyclingWeight && bodyMeasurements.length > 0 && (
                      <span className="ml-1 text-emerald-500">(aus Körperdaten: {bodyMeasurements[bodyMeasurements.length-1]?.weight} kg)</span>
                    )}
                  </label>
                  <div className="flex items-center gap-1 bg-slate-100 rounded-xl px-3 py-2">
                    <input
                      type="number"
                      placeholder={bodyMeasurements[bodyMeasurements.length-1]?.weight?.toString() || '75'}
                      value={cyclingWeight}
                      onChange={e => setCyclingWeight(e.target.value)}
                      className="w-full bg-transparent text-sm font-semibold focus:outline-none"
                    />
                    <span className="text-xs text-slate-500">kg</span>
                  </div>
                </div>
                <div className="w-px h-10 bg-slate-200" />
                <div className="flex-1">
                  <label className="text-xs text-slate-500 block mb-1">FTP (optional)</label>
                  <div className="flex items-center gap-1 bg-slate-100 rounded-xl px-3 py-2">
                    <input
                      type="number"
                      placeholder="z.B. 240"
                      value={cyclingFtp}
                      onChange={e => setCyclingFtp(e.target.value)}
                      className="w-full bg-transparent text-sm font-semibold focus:outline-none"
                    />
                    <span className="text-xs text-slate-500">W</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Calculate Button */}
            <button
              onClick={calcCyclingNutrition}
              disabled={loadingCycling || totalMin === 0}
              className="w-full py-4 rounded-2xl font-bold text-white text-base shadow-lg transition-all mb-5 flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
            >
              {loadingCycling && !loadingRideSync
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Berechne Ernährungsplan…</>
                : <><Bike className="w-5 h-5" /> Ernährungsplan berechnen</>}
            </button>

            {/* Sync nach der Einheit */}
            <button
              onClick={syncRideFromStrava}
              disabled={loadingRideSync || loadingCycling}
              className="w-full py-3 rounded-2xl font-semibold text-violet-700 text-sm border-2 border-violet-200 bg-violet-50 hover:bg-violet-100 transition-all mb-5 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loadingRideSync
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Hole Strava-Daten…</>
                : <><RefreshCw className="w-4 h-4" /> Nach Einheit synchronisieren (Strava)</>}
            </button>

            {cyclingError && (
              <div className="glass rounded-2xl p-4 mb-4 border border-rose-200 bg-rose-50">
                <p className="text-rose-600 text-sm">⚠️ {cyclingError}</p>
              </div>
            )}

            {/* Synchronisierte Einheit – Banner */}
            {syncedRide && cyclingResult?.isActual && (
              <div className="glass rounded-2xl p-4 mb-4 border-l-4 border-violet-400">
                <div className="flex items-center gap-2 mb-2">
                  <RefreshCw className="w-4 h-4 text-violet-500" />
                  <span className="font-bold text-slate-800 text-sm">{syncedRide.name || 'Radeinheit'}</span>
                  <span className="ml-auto text-xs text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">
                    {syncedRide.date ? new Date(syncedRide.date + 'T12:00:00').toLocaleDateString('de-DE', { day: 'numeric', month: 'short' }) : 'synchronisiert'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {syncedRide.movingMinutes != null && <span className="bg-slate-100 text-slate-700 px-2 py-1 rounded-full">⏱ {syncedRide.movingMinutes} min</span>}
                  {syncedRide.calories      != null && <span className="bg-orange-50 text-orange-700 px-2 py-1 rounded-full">🔥 {syncedRide.calories} kcal</span>}
                  {syncedRide.distanceKm    != null && <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-full">📍 {syncedRide.distanceKm} km</span>}
                  {syncedRide.avgHR         != null && <span className="bg-rose-50 text-rose-700 px-2 py-1 rounded-full">❤️ {Math.round(syncedRide.avgHR)} bpm</span>}
                  {syncedRide.avgWatts      != null && <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded-full">⚡ {Math.round(syncedRide.avgWatts)} W</span>}
                </div>
                <p className="text-xs text-violet-500 mt-2">Recovery-Plan an die tatsächlichen Werte angepasst.</p>
              </div>
            )}

            {/* Results */}
            {cyclingResult && (() => {
              const r = cyclingResult;
              return (
                <>
                  {/* Summary bar */}
                  <div className="glass rounded-2xl p-4 mb-4 flex items-center justify-around text-center shadow-md">
                    <div>
                      <p className="text-xl font-bold text-slate-800">{r.totalEnergyKcal}</p>
                      <p className="text-xs text-slate-400">kcal Verbrauch</p>
                    </div>
                    <div className="w-px h-10 bg-slate-200" />
                    <div>
                      <p className="text-xl font-bold text-emerald-600">{r.totalMinutes}</p>
                      <p className="text-xs text-slate-400">Minuten</p>
                    </div>
                    <div className="w-px h-10 bg-slate-200" />
                    <div>
                      <p className="text-xl font-bold text-slate-700">{r.weightKg}</p>
                      <p className="text-xs text-slate-400">kg Gewicht</p>
                    </div>
                    <div className="w-px h-10 bg-slate-200" />
                    <div>
                      <p className="text-xl font-bold text-blue-600">{r.during?.fluidMlTotal || 0}</p>
                      <p className="text-xs text-slate-400">ml Flüssigkeit</p>
                    </div>
                  </div>

                  {/* PRE */}
                  <h3 className="font-bold text-slate-600 text-xs uppercase tracking-widest mb-2 flex items-center gap-1">
                    <Utensils className="w-3.5 h-3.5" /> Vorher
                  </h3>
                  <NutritionCard
                    title="Hauptmahlzeit"
                    icon={<Utensils className="w-4 h-4 text-amber-500" />}
                    timing={r.pre?.meal?.timing}
                    carbsG={r.pre?.meal?.carbsG} proteinG={r.pre?.meal?.proteinG} fatG={r.pre?.meal?.fatG}
                    examples={r.pre?.meal?.examples}
                    accent="border-amber-400"
                  />
                  <NutritionCard
                    title="Snack"
                    icon={<Zap className="w-4 h-4 text-yellow-500" />}
                    timing={r.pre?.snack?.timing}
                    carbsG={r.pre?.snack?.carbsG} proteinG={r.pre?.snack?.proteinG} fatG={r.pre?.snack?.fatG}
                    examples={r.pre?.snack?.examples}
                    accent="border-yellow-400"
                  />

                  {/* DURING */}
                  <h3 className="font-bold text-slate-600 text-xs uppercase tracking-widest mb-2 mt-4 flex items-center gap-1">
                    <Activity className="w-3.5 h-3.5" /> Während der Fahrt
                  </h3>
                  {r.during?.needed === false ? (
                    <div className="glass rounded-2xl p-4 mb-3 border-l-4 border-emerald-300 text-sm text-slate-600">
                      ✅ Bei dieser kurzen/leichten Einheit ist keine Ernährung während der Fahrt nötig.
                      <br />
                      <span className="text-blue-600 font-semibold">💧 Flüssigkeit: {r.during?.fluidMlTotal || 0} ml ({r.during?.fluidMlPerHour || 0} ml/h)</span>
                    </div>
                  ) : (
                    <div className="glass rounded-2xl p-4 mb-3 border-l-4 border-emerald-400">
                      {/* Carb schedule per hour */}
                      {r.during?.carbSchedule?.length > 0 ? (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1">
                            {r.isVeryIntense
                              ? <span className="text-red-500 font-bold">⚡ Hohe Intensität – 80g/h von Beginn an</span>
                              : <span>📈 Carbs-Stufenplan</span>}
                          </p>
                          <div className="flex gap-2 flex-wrap mb-2">
                            {r.during.carbSchedule.map(s => (
                              <div key={s.hour} className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-center min-w-[60px]">
                                <p className="text-xs text-amber-500">Std. {s.hour}</p>
                                <p className="text-sm font-bold text-amber-700">{s.carbsG}g</p>
                                <p className="text-xs text-amber-400">{s.ratePerHour}g/h</p>
                              </div>
                            ))}
                            <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-1.5 text-center min-w-[60px]">
                              <p className="text-xs text-orange-500">Gesamt</p>
                              <p className="text-sm font-bold text-orange-700">{r.during.totalCarbsG}g</p>
                              <p className="text-xs text-orange-400">Carbs</p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2 mb-3">
                          <MacroChip label="Carbs/h"    value={r.during?.perHourCarbsG}  color="bg-amber-50 text-amber-700" />
                          <MacroChip label="Carbs ges." value={r.during?.totalCarbsG}    color="bg-orange-50 text-orange-700" />
                        </div>
                      )}
                      {/* Fluid */}
                      <div className="flex gap-2 mb-2">
                        <MacroChip label="Fluid/h"    value={r.during?.fluidMlPerHour} unit="ml" color="bg-blue-50 text-blue-700" />
                        <MacroChip label="Fluid ges." value={r.during?.fluidMlTotal}   unit="ml" color="bg-cyan-50 text-cyan-700" />
                      </div>
                      {r.during?.electrolytes && (
                        <p className="text-xs text-violet-600 font-semibold mb-1">⚡ Elektrolyte empfohlen</p>
                      )}
                      {r.during?.examples && <p className="text-xs text-slate-500 leading-relaxed">💡 {r.during.examples}</p>}
                    </div>
                  )}

                  {/* POST */}
                  <h3 className="font-bold text-slate-600 text-xs uppercase tracking-widest mb-2 mt-4 flex items-center gap-1">
                    <Wind className="w-3.5 h-3.5" /> Recovery – Nachher
                  </h3>
                  <NutritionCard
                    title="Sofort-Recovery"
                    icon={<Zap className="w-4 h-4 text-emerald-500" />}
                    timing={r.post?.immediate?.timing}
                    carbsG={r.post?.immediate?.carbsG} proteinG={r.post?.immediate?.proteinG} fatG={r.post?.immediate?.fatG}
                    examples={r.post?.immediate?.examples}
                    accent="border-emerald-400"
                  />
                  <NutritionCard
                    title="Mahlzeit"
                    icon={<Utensils className="w-4 h-4 text-teal-500" />}
                    timing={r.post?.meal?.timing}
                    carbsG={r.post?.meal?.carbsG} proteinG={r.post?.meal?.proteinG} fatG={r.post?.meal?.fatG}
                    examples={r.post?.meal?.examples}
                    accent="border-teal-400"
                  />

                  {/* Tips */}
                  {r.tips?.length > 0 && (
                    <div className="glass rounded-2xl p-4 mt-2 mb-4">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Hinweise</p>
                      <ul className="space-y-1">
                        {r.tips.map((tip, i) => (
                          <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                            <span className="text-emerald-500 mt-0.5">•</span>{tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        );
      })()}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* MEAL SUGGESTIONS MODAL                                                    */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {showMealsModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 z-50">
          <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-gradient-to-r from-violet-500 to-purple-600 text-white p-5 rounded-t-3xl flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2"><Sparkles className="w-5 h-5" /> Mahlzeit-Vorschläge</h2>
                <p className="text-xs text-white/70 mt-0.5">5 Gerichte für deine verbleibenden Makros</p>
              </div>
              <button onClick={() => setShowMealsModal(false)} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              {/* Loading */}
              {loadingMeals && (
                <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
                  <p className="text-sm">KI erstellt Vorschläge…</p>
                </div>
              )}

              {/* Error */}
              {mealsError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
                  ⚠ {mealsError}
                </div>
              )}

              {/* Suggestions */}
              {mealSuggestions && mealSuggestions.map((meal, i) => (
                <div key={i} className="border border-slate-200 rounded-2xl p-4 hover:border-violet-300 hover:bg-violet-50/30 transition-all">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl flex-shrink-0 mt-0.5">{meal.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-800 text-sm leading-tight">{meal.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5 leading-snug">{meal.description}</p>
                      {/* Ingredients with quantities */}
                      {meal.ingredients && (
                        <p className="text-xs text-slate-400 mt-1.5 leading-snug">
                          📦 {meal.ingredients}
                        </p>
                      )}
                      {/* Macro chips */}
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        <span className="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-0.5 rounded-full">{Math.round(meal.kcal)} kcal</span>
                        <span className="bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">P {Math.round(meal.protein)}g</span>
                        <span className="bg-amber-100 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">K {Math.round(meal.carbs)}g</span>
                        <span className="bg-purple-100 text-purple-700 text-xs font-semibold px-2 py-0.5 rounded-full">F {Math.round(meal.fat)}g</span>
                        {meal.fiber > 0 && <span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded-full">B {Math.round(meal.fiber)}g</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Refresh button */}
              {mealSuggestions && !loadingMeals && (
                <button
                  onClick={() => {
                    const todayMeals = history[todayKey] || [];
                    const eaten = todayMeals.reduce((s, m) => ({
                      kcal: s.kcal + (m.kcal || 0), protein: s.protein + (m.protein || 0),
                      carbs: s.carbs + (m.carbs || 0), fat: s.fat + (m.fat || 0), fiber: s.fiber + (m.fiber || 0),
                    }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
                    suggestMeals(
                      Math.max(0, effectiveTodayGoal - eaten.kcal),
                      { protein: Math.max(0, macroGoalGrams.protein - eaten.protein), carbs: Math.max(0, macroGoalGrams.carbs - eaten.carbs), fat: Math.max(0, macroGoalGrams.fat - eaten.fat), fiber: Math.max(0, macroGoalGrams.fiber - eaten.fiber) }
                    );
                  }}
                  className="w-full py-3 rounded-xl border-2 border-violet-200 text-violet-600 font-semibold text-sm hover:bg-violet-50 transition-colors flex items-center justify-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" /> Neue Vorschläge
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* BODY MEASUREMENT MODAL                                                   */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {showBodyModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-violet-500 to-purple-500 text-white p-5 rounded-t-3xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Scale className="w-6 h-6" />
                <h2 className="text-lg font-bold">Messung hinzufügen</h2>
              </div>
              <button onClick={() => { setShowBodyModal(false); setBodyScreenshotPreview(null); }} className="p-2 hover:bg-white/20 rounded-lg transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Mode toggle */}
              <div className="flex gap-2 bg-slate-100 rounded-xl p-1">
                {[{ key: 'screenshot', label: 'Screenshot', icon: <Upload className="w-4 h-4" /> }, { key: 'manual', label: 'Manuell', icon: <Settings className="w-4 h-4" /> }].map(m => (
                  <button
                    key={m.key}
                    onClick={() => setBodyInputMode(m.key)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-all ${bodyInputMode === m.key ? 'bg-white shadow text-violet-700' : 'text-slate-500'}`}
                  >
                    {m.icon} {m.label}
                  </button>
                ))}
              </div>

              {/* Date */}
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Datum</label>
                <input
                  type="date"
                  value={bodyDraft.date}
                  max={toDateKey(new Date())}
                  onChange={(e) => setBodyDraft({ ...bodyDraft, date: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl border-2 border-slate-200 focus:border-violet-400 focus:outline-none text-sm"
                />
              </div>

              {/* Screenshot mode */}
              {bodyInputMode === 'screenshot' && (
                <div>
                  <input
                    ref={bodyFileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleBodyScreenshot(e.target.files?.[0])}
                  />
                  <button
                    onClick={() => bodyFileRef.current?.click()}
                    disabled={loadingBody}
                    className="w-full py-3 border-2 border-dashed border-violet-300 rounded-xl text-violet-600 text-sm font-semibold hover:bg-violet-50 transition flex items-center justify-center gap-2"
                  >
                    {loadingBody ? <><Loader2 className="w-4 h-4 animate-spin" /> Lese Werte aus...</> : <><Upload className="w-4 h-4" /> Screenshot hochladen</>}
                  </button>
                  {bodyScreenshotPreview && (
                    <img src={bodyScreenshotPreview} alt="Preview" className="mt-2 rounded-xl w-full max-h-40 object-contain bg-slate-50" />
                  )}
                  {bodyScreenshotPreview && (
                    <p className="text-xs text-slate-400 text-center mt-1">Ausgelesene Werte – bitte prüfen und ggf. korrigieren:</p>
                  )}
                </div>
              )}

              {/* Fields */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'weight',       label: 'Gewicht',     unit: 'kg',  placeholder: '75.5' },
                  { key: 'fatPct',       label: 'Körperfett',  unit: '%',   placeholder: '20.0' },
                  { key: 'musclePct',    label: 'Muskelmasse', unit: '%',   placeholder: '38.0' },
                  { key: 'visceralFat',  label: 'Viszerales Fett', unit: '', placeholder: '8'  },
                  { key: 'muscleMassKg', label: 'Muskeln',     unit: 'kg',  placeholder: '28.5' },
                  { key: 'bmi',          label: 'BMI',         unit: '',    placeholder: '23.4' },
                ].map(f => (
                  <div key={f.key}>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">{f.label} {f.unit && <span className="font-normal text-slate-400">({f.unit})</span>}</label>
                    <input
                      type="number"
                      step="0.1"
                      value={bodyDraft[f.key]}
                      onChange={(e) => setBodyDraft({ ...bodyDraft, [f.key]: e.target.value })}
                      placeholder={f.placeholder}
                      className="w-full px-3 py-2 rounded-xl border-2 border-slate-200 focus:border-violet-400 focus:outline-none text-sm"
                    />
                  </div>
                ))}
              </div>

              <button
                onClick={addBodyMeasurement}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white font-bold text-sm shadow-lg transition"
              >
                Messung speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* BODY GOALS MODAL                                                         */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {showBodyGoalsModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full">
            <div className="bg-gradient-to-r from-emerald-500 to-teal-500 text-white p-5 rounded-t-3xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Target className="w-6 h-6" />
                <h2 className="text-lg font-bold">Zielwerte</h2>
              </div>
              <button onClick={() => setShowBodyGoalsModal(false)} className="p-2 hover:bg-white/20 rounded-lg transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {[
                { key: 'weight',      label: 'Zielgewicht',         unit: 'kg', placeholder: '72.0' },
                { key: 'fatPct',      label: 'Ziel-Körperfettanteil', unit: '%', placeholder: '18.0' },
                { key: 'musclePct',   label: 'Ziel-Muskelmasse',    unit: '%', placeholder: '40.0' },
                { key: 'visceralFat', label: 'Ziel-Viszerales Fett', unit: '',  placeholder: '6'   },
              ].map(f => (
                <div key={f.key}>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">{f.label} {f.unit && <span className="font-normal text-slate-400">({f.unit})</span>}</label>
                  <input
                    type="number"
                    step="0.1"
                    value={bodyGoalsDraft[f.key]}
                    onChange={(e) => setBodyGoalsDraft({ ...bodyGoalsDraft, [f.key]: e.target.value })}
                    placeholder={f.placeholder}
                    className="w-full px-4 py-2.5 rounded-xl border-2 border-slate-200 focus:border-emerald-400 focus:outline-none"
                  />
                </div>
              ))}

              <div className="flex gap-3">
                <button
                  onClick={() => setShowBodyGoalsModal(false)}
                  className="flex-1 py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-semibold hover:bg-slate-50 transition text-sm"
                >
                  Abbrechen
                </button>
                <button
                  onClick={() => {
                    saveBodyGoalsData({
                      weight:      bodyGoalsDraft.weight      ? parseFloat(bodyGoalsDraft.weight)      : null,
                      fatPct:      bodyGoalsDraft.fatPct      ? parseFloat(bodyGoalsDraft.fatPct)      : null,
                      musclePct:   bodyGoalsDraft.musclePct   ? parseFloat(bodyGoalsDraft.musclePct)   : null,
                      visceralFat: bodyGoalsDraft.visceralFat ? parseFloat(bodyGoalsDraft.visceralFat) : null,
                    });
                    setShowBodyGoalsModal(false);
                  }}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-bold shadow-lg transition text-sm"
                >
                  Speichern
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* CALCULATOR MODAL                                                         */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {showCalculator && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-500 text-white p-5 rounded-t-3xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Calculator className="w-7 h-7" />
                <h2 className="text-xl font-bold">Kalorienziel berechnen</h2>
              </div>
              <button
                onClick={() => { setShowCalculator(false); setCalculatedGoal(null); }}
                className="p-2 hover:bg-white/20 rounded-lg transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5">
              {!calculatedGoal ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-2">Geschlecht</label>
                    <div className="grid grid-cols-2 gap-3">
                      {[{ v: 'male', l: 'Männlich' }, { v: 'female', l: 'Weiblich' }].map(g => (
                        <button
                          key={g.v}
                          onClick={() => setCalculatorData({ ...calculatorData, gender: g.v })}
                          className={`p-3 rounded-xl border-2 font-medium transition ${
                            calculatorData.gender === g.v ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          {g.l}
                        </button>
                      ))}
                    </div>
                  </div>

                  {[
                    { key: 'age',    label: 'Alter (Jahre)', placeholder: 'z.B. 30'  },
                    { key: 'weight', label: 'Gewicht (kg)',  placeholder: 'z.B. 75'  },
                    { key: 'height', label: 'Größe (cm)',    placeholder: 'z.B. 175' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-sm font-semibold text-slate-700 mb-1">{f.label}</label>
                      <input
                        type="number"
                        value={calculatorData[f.key]}
                        onChange={(e) => setCalculatorData({ ...calculatorData, [f.key]: e.target.value })}
                        placeholder={f.placeholder}
                        className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                  ))}

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Aktivitätslevel</label>
                    <select
                      value={calculatorData.activity}
                      onChange={(e) => setCalculatorData({ ...calculatorData, activity: e.target.value })}
                      className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 focus:border-blue-500 focus:outline-none"
                    >
                      <option value="1.2">Wenig/kein Sport</option>
                      <option value="1.375">Leichter Sport (1–3 Tage/Woche)</option>
                      <option value="1.55">Moderater Sport (3–5 Tage/Woche)</option>
                      <option value="1.725">Intensiver Sport (6–7 Tage/Woche)</option>
                      <option value="1.9">Sehr intensiver Sport (2× täglich)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Dein Ziel</label>
                    <div className="grid grid-cols-3 gap-2">
                      {[{ v: 'lose', l: 'Abnehmen' }, { v: 'maintain', l: 'Halten' }, { v: 'gain', l: 'Zunehmen' }].map(g => (
                        <button
                          key={g.v}
                          onClick={() => setCalculatorData({ ...calculatorData, goal: g.v })}
                          className={`p-3 rounded-xl border-2 font-medium text-sm transition ${
                            calculatorData.goal === g.v ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          {g.l}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={calculateCalorieGoal}
                    className="w-full py-4 rounded-xl bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-bold text-lg shadow-lg transition"
                  >
                    Berechnen
                  </button>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="text-center py-6">
                    <div className="w-20 h-20 rounded-full bg-gradient-to-br from-green-100 to-emerald-100 mx-auto mb-3 flex items-center justify-center">
                      <Check className="w-10 h-10 text-green-600" />
                    </div>
                    <p className="text-slate-600 mb-1">Dein empfohlenes Kalorienziel:</p>
                    <p className="text-6xl font-bold text-emerald-600 mono">{calculatedGoal}</p>
                    <p className="text-xl text-slate-700 font-semibold">kcal / Tag</p>
                  </div>
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                    <p className="text-sm text-blue-800">
                      <strong>Hinweis:</strong> Berechnung nach Mifflin-St Jeor Formel.
                      {calculatorData.goal === 'lose' && ' 500 kcal Defizit für Abnehmen eingerechnet.'}
                      {calculatorData.goal === 'gain' && ' 500 kcal Überschuss für Zunehmen eingerechnet.'}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setCalculatedGoal(null)}
                      className="flex-1 py-3 rounded-xl border-2 border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold transition"
                    >
                      Neu berechnen
                    </button>
                    <button
                      onClick={() => { saveCalorieGoal(calculatedGoal); setShowCalculator(false); setCalculatedGoal(null); }}
                      className="flex-1 py-3 rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white font-bold shadow-lg transition"
                    >
                      Übernehmen
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* PRESET SETTINGS MODAL                                                    */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {showPresetSettings && presetDraft && (() => {
        const p = presetDraft[editingPresetKey];
        const pctSum = p.proteinPct + p.carbsPct + p.fatPct;
        const isValid = pctSum === 100;

        const grams = {
          protein: Math.round((p.kcal * p.proteinPct / 100) / 4),
          carbs:   Math.round((p.kcal * p.carbsPct   / 100) / 4),
          fat:     Math.round((p.kcal * p.fatPct     / 100) / 9),
        };

        const allValid = Object.keys(presetDraft).every(k => {
          const q = presetDraft[k];
          return q.proteinPct + q.carbsPct + q.fatPct === 100 && q.kcal > 0;
        });

        const updateP = (field, val) =>
          setPresetDraft({ ...presetDraft, [editingPresetKey]: { ...p, [field]: val } });

        const presetTabs = [
          { key: 'rest',       color: 'from-slate-400 to-slate-500'   },
          { key: 'active',     color: 'from-emerald-500 to-teal-500'  },
          { key: 'veryActive', color: 'from-orange-500 to-rose-500'   },
        ];

        const macroRows = [
          { field: 'proteinPct', label: 'Protein',       color: 'text-blue-600',   bar: 'bg-blue-500',   grams: grams.protein },
          { field: 'carbsPct',   label: 'Kohlenhydrate', color: 'text-amber-600',  bar: 'bg-amber-500',  grams: grams.carbs   },
          { field: 'fatPct',     label: 'Fett',          color: 'text-purple-600', bar: 'bg-purple-500', grams: grams.fat     },
        ];

        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">

              {/* Header */}
              <div className="sticky top-0 bg-gradient-to-r from-slate-700 to-slate-800 text-white p-5 rounded-t-3xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Settings className="w-6 h-6" />
                  <h2 className="text-xl font-bold">Presets anpassen</h2>
                </div>
                <button onClick={() => setShowPresetSettings(false)} className="p-2 hover:bg-white/20 rounded-lg transition">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4">

                {/* Preset tabs */}
                <div className="flex gap-2">
                  {presetTabs.map(t => {
                    const pd = presetDraft[t.key];
                    const tabSum = pd.proteinPct + pd.carbsPct + pd.fatPct;
                    const tabOk = tabSum === 100 && pd.kcal > 0;
                    return (
                      <button
                        key={t.key}
                        onClick={() => setEditingPresetKey(t.key)}
                        className={`flex-1 py-2.5 rounded-xl text-sm font-semibold flex flex-col items-center gap-0.5 transition-all border-2 ${
                          editingPresetKey === t.key
                            ? 'border-slate-700 bg-slate-700 text-white'
                            : 'border-slate-200 hover:border-slate-300 text-slate-600'
                        }`}
                      >
                        <span>{pd.emoji}</span>
                        <span className="text-xs">{pd.label}</span>
                        {!tabOk && <span className="text-xs text-red-400">⚠</span>}
                      </button>
                    );
                  })}
                </div>

                {/* Preset name + emoji */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Emoji</label>
                    <input
                      type="text"
                      value={p.emoji}
                      onChange={(e) => updateP('emoji', e.target.value)}
                      maxLength={2}
                      className="w-full text-center text-2xl border-2 border-slate-200 rounded-xl py-2 focus:outline-none focus:border-slate-400"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-500 mb-1">Name</label>
                    <input
                      type="text"
                      value={p.label}
                      onChange={(e) => updateP('label', e.target.value)}
                      className="w-full px-3 py-2 border-2 border-slate-200 rounded-xl focus:outline-none focus:border-slate-400 font-semibold"
                    />
                  </div>
                </div>

                {/* Calories */}
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
                  <label className="block text-xs font-semibold text-orange-600 mb-2 uppercase tracking-wide">Kalorienziel</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateP('kcal', Math.max(500, p.kcal - 50))}
                      className="w-9 h-9 rounded-xl bg-white border border-orange-200 text-orange-600 font-bold hover:bg-orange-50 transition flex items-center justify-center text-lg"
                    >−</button>
                    <input
                      type="number"
                      value={p.kcal}
                      onChange={(e) => updateP('kcal', Math.max(0, parseInt(e.target.value) || 0))}
                      className="flex-1 text-center text-2xl font-bold mono border-2 border-orange-200 rounded-xl py-2 focus:outline-none focus:border-orange-400"
                    />
                    <span className="text-orange-600 font-semibold">kcal</span>
                    <button
                      onClick={() => updateP('kcal', p.kcal + 50)}
                      className="w-9 h-9 rounded-xl bg-white border border-orange-200 text-orange-600 font-bold hover:bg-orange-50 transition flex items-center justify-center text-lg"
                    >+</button>
                  </div>
                </div>

                {/* Macro % */}
                <div className="space-y-3">
                  {macroRows.map(m => (
                    <div key={m.field} className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className={`font-bold text-sm ${m.color}`}>{m.label}</span>
                          <span className="text-slate-400 text-xs ml-2 mono">→ {m.grams}g · {Math.round(p.kcal * p[m.field] / 100)} kcal</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => updateP(m.field, Math.max(0, p[m.field] - 1))}
                            className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-500 font-bold hover:bg-slate-100 transition flex items-center justify-center"
                          >−</button>
                          <input
                            type="number"
                            min="0" max="100"
                            value={p[m.field]}
                            onChange={(e) => updateP(m.field, Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                            className="w-12 text-center font-bold border-2 border-slate-200 rounded-lg py-1 focus:outline-none focus:border-slate-400"
                          />
                          <span className={`text-xs font-bold ${m.color}`}>%</span>
                          <button
                            onClick={() => updateP(m.field, Math.min(100, p[m.field] + 1))}
                            className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-500 font-bold hover:bg-slate-100 transition flex items-center justify-center"
                          >+</button>
                        </div>
                      </div>
                      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div className={`h-full ${m.bar} rounded-full transition-all duration-300`} style={{ width: `${p[m.field]}%` }} />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Sum indicator */}
                <div className={`rounded-xl p-3 border flex items-center justify-between ${
                  isValid ? 'bg-green-50 border-green-200' : pctSum > 100 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
                }`}>
                  <span className={`font-semibold text-sm ${isValid ? 'text-green-700' : pctSum > 100 ? 'text-red-700' : 'text-amber-700'}`}>Gesamt</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xl font-bold mono ${isValid ? 'text-green-700' : pctSum > 100 ? 'text-red-700' : 'text-amber-700'}`}>{pctSum}%</span>
                    {isValid
                      ? <span className="text-green-600">✓</span>
                      : <span className={`text-xs font-medium ${pctSum > 100 ? 'text-red-600' : 'text-amber-600'}`}>
                          {pctSum > 100 ? `${pctSum - 100}% zu viel` : `${100 - pctSum}% fehlen`}
                        </span>
                    }
                  </div>
                </div>

                {/* Fiber */}
                <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                  <label className="block text-xs font-semibold text-green-600 mb-2 uppercase tracking-wide">Ballaststoffe</label>
                  <div className="flex items-center gap-2">
                    <button onClick={() => updateP('fiberG', Math.max(0, p.fiberG - 1))} className="w-8 h-8 rounded-lg bg-white border border-green-200 text-green-600 font-bold hover:bg-green-50 transition flex items-center justify-center">−</button>
                    <input
                      type="number" min="0" value={p.fiberG}
                      onChange={(e) => updateP('fiberG', Math.max(0, parseInt(e.target.value) || 0))}
                      className="flex-1 text-center text-xl font-bold mono border-2 border-green-200 rounded-xl py-1.5 focus:outline-none focus:border-green-400"
                    />
                    <span className="text-green-600 font-semibold">g</span>
                    <button onClick={() => updateP('fiberG', p.fiberG + 1)} className="w-8 h-8 rounded-lg bg-white border border-green-200 text-green-600 font-bold hover:bg-green-50 transition flex items-center justify-center">+</button>
                  </div>
                </div>

                {/* Reset + Save */}
                <div className="flex gap-3">
                  <button
                    onClick={() => setPresetDraft(JSON.parse(JSON.stringify({ ...presetDraft, [editingPresetKey]: DEFAULT_PRESETS[editingPresetKey] })))}
                    className="px-4 py-3 rounded-xl border-2 border-slate-200 hover:bg-slate-50 text-slate-600 text-sm font-semibold transition"
                  >
                    Zurücksetzen
                  </button>
                  <button
                    disabled={!allValid}
                    onClick={() => {
                      savePresets(presetDraft);
                      // If the currently active preset was edited, re-apply it
                      if (activePreset) {
                        const p = presetDraft[activePreset];
                        saveCalorieGoal(p.kcal);
                        saveMacroGoals({ proteinPct: p.proteinPct, carbsPct: p.carbsPct, fatPct: p.fatPct, fiberG: p.fiberG });
                      }
                      setShowPresetSettings(false);
                    }}
                    className="flex-1 py-3 rounded-xl bg-gradient-to-r from-slate-700 to-slate-800 hover:from-slate-800 hover:to-slate-900 text-white font-bold shadow-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {allValid ? 'Alle Presets speichern' : 'Bitte Werte korrigieren'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ════════════════════════════════════════════════════════════════════════ */}
      {/* MACRO GOALS MODAL                                                        */}
      {/* ════════════════════════════════════════════════════════════════════════ */}
      {showMacroGoals && macroDraft && (() => {
        const pctSum = macroDraft.proteinPct + macroDraft.carbsPct + macroDraft.fatPct;
        const isValid = pctSum === 100;

        const draftGrams = {
          protein: Math.round((calorieGoal * macroDraft.proteinPct / 100) / 4),
          carbs:   Math.round((calorieGoal * macroDraft.carbsPct   / 100) / 4),
          fat:     Math.round((calorieGoal * macroDraft.fatPct     / 100) / 9),
        };
        const draftKcal = {
          protein: Math.round(calorieGoal * macroDraft.proteinPct / 100),
          carbs:   Math.round(calorieGoal * macroDraft.carbsPct   / 100),
          fat:     Math.round(calorieGoal * macroDraft.fatPct     / 100),
        };

        const macroFields = [
          { key: 'proteinPct', label: 'Protein',       color: 'text-blue-600',   bg: 'bg-blue-500',   light: 'bg-blue-100',   border: 'border-blue-300',   grams: draftGrams.protein, kcal: draftKcal.protein  },
          { key: 'carbsPct',   label: 'Kohlenhydrate', color: 'text-amber-600',  bg: 'bg-amber-500',  light: 'bg-amber-100',  border: 'border-amber-300',  grams: draftGrams.carbs,   kcal: draftKcal.carbs    },
          { key: 'fatPct',     label: 'Fett',          color: 'text-purple-600', bg: 'bg-purple-500', light: 'bg-purple-100', border: 'border-purple-300', grams: draftGrams.fat,     kcal: draftKcal.fat      },
        ];

        return (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-3xl shadow-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto">

              {/* Header */}
              <div className="sticky top-0 bg-gradient-to-r from-violet-500 to-purple-500 text-white p-5 rounded-t-3xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Target className="w-7 h-7" />
                  <h2 className="text-xl font-bold">Makroziele</h2>
                </div>
                <button
                  onClick={() => setShowMacroGoals(false)}
                  className="p-2 hover:bg-white/20 rounded-lg transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-5">

                {/* Calorie reference */}
                <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center justify-between">
                  <p className="text-sm text-orange-700 font-medium">Basis: Kalorienziel</p>
                  <p className="text-2xl font-bold mono text-orange-600">{calorieGoal} kcal</p>
                </div>

                {/* Macro percentage inputs */}
                {macroFields.map(f => (
                  <div key={f.key} className={`rounded-xl border ${f.border} p-4 ${f.light}`}>
                    <div className="flex items-center justify-between mb-3">
                      <p className={`font-bold ${f.color}`}>{f.label}</p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setMacroDraft({ ...macroDraft, [f.key]: Math.max(0, macroDraft[f.key] - 1) })}
                          className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition flex items-center justify-center"
                        >−</button>
                        <input
                          type="number"
                          min="0" max="100"
                          value={macroDraft[f.key]}
                          onChange={(e) => setMacroDraft({ ...macroDraft, [f.key]: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)) })}
                          className="w-14 text-center font-bold text-lg border-2 border-slate-200 rounded-lg py-1 focus:outline-none focus:border-violet-400"
                        />
                        <span className={`font-bold ${f.color}`}>%</span>
                        <button
                          onClick={() => setMacroDraft({ ...macroDraft, [f.key]: Math.min(100, macroDraft[f.key] + 1) })}
                          className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition flex items-center justify-center"
                        >+</button>
                      </div>
                    </div>
                    {/* Progress bar preview */}
                    <div className="h-2 bg-white/70 rounded-full overflow-hidden mb-2">
                      <div
                        className={`h-full ${f.bg} rounded-full transition-all duration-300`}
                        style={{ width: `${macroDraft[f.key]}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className={`${f.color} font-semibold mono`}>{f.grams}g</span>
                      <span className={`${f.color} opacity-70`}>{f.kcal} kcal</span>
                    </div>
                  </div>
                ))}

                {/* Sum indicator */}
                <div className={`rounded-xl p-4 border flex items-center justify-between ${
                  isValid
                    ? 'bg-green-50 border-green-200'
                    : pctSum > 100
                    ? 'bg-red-50 border-red-200'
                    : 'bg-amber-50 border-amber-200'
                }`}>
                  <p className={`font-semibold text-sm ${isValid ? 'text-green-700' : pctSum > 100 ? 'text-red-700' : 'text-amber-700'}`}>
                    Gesamt
                  </p>
                  <div className="flex items-center gap-2">
                    <span className={`text-2xl font-bold mono ${isValid ? 'text-green-700' : pctSum > 100 ? 'text-red-700' : 'text-amber-700'}`}>
                      {pctSum}%
                    </span>
                    {isValid
                      ? <span className="text-green-600 text-lg">✓</span>
                      : <span className={`text-sm font-medium ${pctSum > 100 ? 'text-red-600' : 'text-amber-600'}`}>
                          {pctSum > 100 ? `${pctSum - 100}% zu viel` : `${100 - pctSum}% fehlen`}
                        </span>
                    }
                  </div>
                </div>

                {/* Fiber goal (independent) */}
                <div className="rounded-xl border border-green-300 bg-green-50 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-bold text-green-700">Ballaststoffe</p>
                    <p className="text-xs text-green-600 opacity-70">unabhängig vom Kalorienziel</p>
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => setMacroDraft({ ...macroDraft, fiberG: Math.max(0, macroDraft.fiberG - 1) })}
                      className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition flex items-center justify-center"
                    >−</button>
                    <input
                      type="number"
                      min="0"
                      value={macroDraft.fiberG}
                      onChange={(e) => setMacroDraft({ ...macroDraft, fiberG: Math.max(0, parseInt(e.target.value) || 0) })}
                      className="w-16 text-center font-bold text-lg border-2 border-slate-200 rounded-lg py-1 focus:outline-none focus:border-green-400"
                    />
                    <span className="font-bold text-green-700">g / Tag</span>
                    <button
                      onClick={() => setMacroDraft({ ...macroDraft, fiberG: macroDraft.fiberG + 1 })}
                      className="w-7 h-7 rounded-lg bg-white border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition flex items-center justify-center"
                    >+</button>
                  </div>
                  <p className="text-xs text-green-600 mt-2">Empfehlung: 25–38g pro Tag</p>
                </div>

                {/* Save */}
                <button
                  disabled={!isValid}
                  onClick={() => { saveMacroGoals(macroDraft); setShowMacroGoals(false); }}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 hover:from-violet-600 hover:to-purple-600 text-white font-bold text-lg shadow-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isValid ? 'Ziele speichern' : `Noch ${100 - pctSum}% zuweisen`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default KalorienTracker;
