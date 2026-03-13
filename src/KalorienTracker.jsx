import React, { useState, useEffect, useRef } from 'react';
import {
  Loader2, Send, Plus, Trash2, Flame, ChevronDown, Calculator,
  X, Check, ChevronLeft, ChevronRight, Droplets, BarChart2, Calendar, TrendingUp, Target, Settings
} from 'lucide-react';

const toDateKey = (d) => {
  const date = d instanceof Date ? d : new Date(d);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

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
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [expandedMealId, setExpandedMealId] = useState(null);
  const [calorieGoal, setCalorieGoal] = useState(2000);
  const [showCalculator, setShowCalculator] = useState(false);
  const [calculatorData, setCalculatorData] = useState({
    gender: 'male', age: '', weight: '', height: '', activity: '1.2', goal: 'maintain'
  });
  const [calculatedGoal, setCalculatedGoal] = useState(null);
  const [macroGoals, setMacroGoals] = useState({ proteinPct: 30, carbsPct: 40, fatPct: 30, fiberG: 30 });
  const [showMacroGoals, setShowMacroGoals] = useState(false);
  const [macroDraft, setMacroDraft] = useState(null);
  const [presets, setPresets] = useState(DEFAULT_PRESETS);
  const [activePreset, setActivePreset] = useState(null);
  const [showPresetSettings, setShowPresetSettings] = useState(false);
  const [presetDraft, setPresetDraft] = useState(null);
  const [editingPresetKey, setEditingPresetKey] = useState('rest');
  const messagesEndRef = useRef(null);

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
      if (savedGoal) setCalorieGoal(parseInt(savedGoal));

      const savedMacros = localStorage.getItem('macro-goals');
      if (savedMacros) setMacroGoals(JSON.parse(savedMacros));

      const savedPresets = localStorage.getItem('presets-data');
      if (savedPresets) setPresets(JSON.parse(savedPresets));

      const savedActivePreset = localStorage.getItem('active-preset');
      if (savedActivePreset) setActivePreset(savedActivePreset);
    } catch (e) {
      console.error('Ladefehler:', e);
    } finally {
      setLoadingInitial(false);
    }
  }, []);

  // ── Persist ─────────────────────────────────────────────────────────────────
  const saveHistory = (newHistory) => {
    setHistory(newHistory);
    localStorage.setItem('history-data', JSON.stringify(newHistory));
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

  const applyPreset = (key) => {
    const p = presets[key];
    saveCalorieGoal(p.kcal);
    saveMacroGoals({ proteinPct: p.proteinPct, carbsPct: p.carbsPct, fatPct: p.fatPct, fiberG: p.fiberG });
    setActivePreset(key);
    localStorage.setItem('active-preset', key);
  };

  // ── Computed macro goals in grams ────────────────────────────────────────────
  // Protein & Carbs: 4 kcal/g  |  Fat: 9 kcal/g  |  Fiber: fixed grams
  const macroGoalGrams = {
    protein: Math.round((calorieGoal * macroGoals.proteinPct / 100) / 4),
    carbs:   Math.round((calorieGoal * macroGoals.carbsPct  / 100) / 4),
    fat:     Math.round((calorieGoal * macroGoals.fatPct    / 100) / 9),
    fiber:   macroGoals.fiberG,
  };

  // ── Derived state ────────────────────────────────────────────────────────────
  const currentMeals = history[selectedDate] || [];
  const currentWater = waterHistory[selectedDate] || 0;
  const isToday = selectedDate === todayKey;

  const totals = currentMeals.reduce((acc, meal) => ({
    kcal: acc.kcal + (meal.kcal || 0),
    protein: acc.protein + (meal.protein || 0),
    carbs: acc.carbs + (meal.carbs || 0),
    fat: acc.fat + (meal.fat || 0),
    fiber: acc.fiber + (meal.fiber || 0),
  }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

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
  };

  // ── Stats helpers ────────────────────────────────────────────────────────────
  const getLastNDays = (n) =>
    Array.from({ length: n }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (n - 1 - i));
      return toDateKey(d);
    });

  const getCurrentMonthDays = () => {
    const now = new Date();
    return Array.from({ length: now.getDate() }, (_, i) =>
      toDateKey(new Date(now.getFullYear(), now.getMonth(), i + 1))
    );
  };

  const calcStats = (days) => {
    const tracked = days.filter(d => history[d]?.length > 0);
    if (tracked.length === 0) return null;

    const sums = tracked.reduce((acc, d) =>
      (history[d] || []).reduce((a, m) => ({
        kcal: a.kcal + (m.kcal || 0),
        protein: a.protein + (m.protein || 0),
        carbs: a.carbs + (m.carbs || 0),
        fat: a.fat + (m.fat || 0),
        fiber: a.fiber + (m.fiber || 0),
      }), acc),
      { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
    );

    const n = tracked.length;
    const waterDays = days.filter(d => (waterHistory[d] || 0) > 0);
    const waterSum = waterDays.reduce((acc, d) => acc + (waterHistory[d] || 0), 0);

    const dayData = days.map(d => ({
      date: d,
      kcal: Math.round((history[d] || []).reduce((a, m) => a + (m.kcal || 0), 0)),
      water: waterHistory[d] || 0,
    }));

    const maxKcal = Math.max(...dayData.map(d => d.kcal), calorieGoal, 1);

    return {
      avg: {
        kcal: Math.round(sums.kcal / n),
        protein: Math.round(sums.protein / n),
        carbs: Math.round(sums.carbs / n),
        fat: Math.round(sums.fat / n),
        fiber: Math.round(sums.fiber / n),
      },
      trackedDays: n,
      totalDays: days.length,
      avgWater: waterDays.length > 0 ? (waterSum / waterDays.length).toFixed(1) : '0.0',
      dayData,
      maxKcal,
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

  const weekDays = getLastNDays(7);
  const monthDays = getCurrentMonthDays();
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
            <div className="glass rounded-3xl p-6 mb-4 shadow-xl">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-xl font-bold text-slate-800">Übersicht</h2>
                <div className="text-right">
                  <p className="text-5xl font-bold mono bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
                    {Math.round(totals.kcal)}
                  </p>
                  <p className="text-slate-500 text-xs font-semibold uppercase tracking-wide">Kalorien</p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mb-5">
                <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r transition-all duration-500 ease-out rounded-full ${
                      totals.kcal > calorieGoal ? 'from-red-500 to-rose-500' : 'from-emerald-500 to-teal-500'
                    }`}
                    style={{ width: `${Math.min((totals.kcal / calorieGoal) * 100, 100)}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1.5">
                  <span className="text-xs text-slate-500">
                    {totals.kcal > calorieGoal
                      ? `${Math.round(totals.kcal - calorieGoal)} kcal über Ziel`
                      : `${Math.round(calorieGoal - totals.kcal)} kcal verbleibend`}
                  </span>
                  <span className="text-xs text-slate-500">Ziel: {calorieGoal} kcal</span>
                </div>
              </div>

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
          const title = isWeek
            ? 'Letzte 7 Tage'
            : new Date().toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });

          return (
            <>
              <h2 className="text-2xl font-bold text-slate-800 mb-4 text-center">{title}</h2>

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
                        { label: 'Protein',       value: stats.avg.protein, from: 'from-blue-50',   to: 'to-blue-100',   border: 'border-blue-200',   color: 'text-blue-600',   num: 'text-blue-900'   },
                        { label: 'Kohlenhydrate', value: stats.avg.carbs,   from: 'from-amber-50',  to: 'to-amber-100',  border: 'border-amber-200',  color: 'text-amber-600',  num: 'text-amber-900'  },
                        { label: 'Fett',          value: stats.avg.fat,     from: 'from-purple-50', to: 'to-purple-100', border: 'border-purple-200', color: 'text-purple-600', num: 'text-purple-900' },
                        { label: 'Ballaststoffe', value: stats.avg.fiber,   from: 'from-green-50',  to: 'to-green-100',  border: 'border-green-200',  color: 'text-green-600',  num: 'text-green-900'  },
                      ].map(s => (
                        <div key={s.label} className={`bg-gradient-to-br ${s.from} ${s.to} border ${s.border} rounded-xl p-4`}>
                          <p className={`${s.color} text-xs font-semibold uppercase tracking-wide mb-1`}>{s.label}</p>
                          <p className={`text-2xl font-bold mono ${s.num}`}>{s.value}g</p>
                        </div>
                      ))}

                      {/* Water average */}
                      <div className="bg-gradient-to-br from-cyan-50 to-blue-50 border border-cyan-200 rounded-xl p-4">
                        <p className="text-cyan-600 text-xs font-semibold uppercase tracking-wide mb-1 flex items-center gap-1">
                          <Droplets className="w-3 h-3" /> Wasser
                        </p>
                        <p className="text-2xl font-bold mono text-cyan-900">{stats.avgWater} L</p>
                        <p className="text-xs text-cyan-400 mt-1">Ziel: 2–3L</p>
                      </div>
                    </div>
                  </div>

                  {/* Bar chart */}
                  <div className="glass rounded-3xl p-6 shadow-xl">
                    <h3 className="text-lg font-bold text-slate-800 mb-1">Kalorien pro Tag</h3>
                    <p className="text-xs text-slate-400 mb-4">Klick auf einen Balken → Tagesdetails öffnen</p>

                    <div className="flex items-end gap-1" style={{ height: '140px' }}>
                      {stats.dayData.map((day) => {
                        const pct = day.kcal > 0 ? (day.kcal / stats.maxKcal) * 100 : 0;
                        const goalPct = (calorieGoal / stats.maxKcal) * 100;
                        const isOver = day.kcal > calorieGoal;
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
                              {day.kcal > 0 ? (
                                <div
                                  className={`w-full rounded-t-md transition-all group-hover:opacity-75 ${
                                    isOver
                                      ? 'bg-gradient-to-t from-red-500 to-rose-400'
                                      : 'bg-gradient-to-t from-emerald-500 to-teal-400'
                                  } ${isSel ? 'ring-2 ring-offset-1 ring-slate-500' : ''}`}
                                  style={{ height: `${pct}%` }}
                                  title={`${day.kcal} kcal`}
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
                </>
              )}
            </>
          );
        })()}
      </div>

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
