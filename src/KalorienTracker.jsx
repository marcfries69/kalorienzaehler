import React, { useState, useEffect, useRef } from 'react';
import {
  Loader2, Send, Plus, Trash2, Flame, ChevronDown, Calculator,
  X, Check, ChevronLeft, ChevronRight, Droplets, BarChart2, Calendar, TrendingUp
} from 'lucide-react';

const toDateKey = (d) => {
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().split('T')[0];
};

const todayKey = toDateKey(new Date());

const KalorienTracker = () => {
  const [history, setHistory] = useState({});
  const [waterHistory, setWaterHistory] = useState({});
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [activeTab, setActiveTab] = useState('day');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [expandedMealId, setExpandedMealId] = useState(null);
  const [calorieGoal, setCalorieGoal] = useState(2000);
  const [showCalculator, setShowCalculator] = useState(false);
  const [calculatorData, setCalculatorData] = useState({
    gender: 'male', age: '', weight: '', height: '', activity: '1.2', goal: 'maintain'
  });
  const [calculatedGoal, setCalculatedGoal] = useState(null);
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
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return Array.from({ length: now.getDate() }, (_, i) =>
      `${year}-${month}-${String(i + 1).padStart(2, '0')}`
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
              Kalorienziel berechnen
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

              {/* Macro cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Protein',       value: totals.protein, from: 'from-blue-50',   to: 'to-blue-100',   border: 'border-blue-200',   color: 'text-blue-600',   num: 'text-blue-900'   },
                  { label: 'Kohlenhydrate', value: totals.carbs,   from: 'from-amber-50',  to: 'to-amber-100',  border: 'border-amber-200',  color: 'text-amber-600',  num: 'text-amber-900'  },
                  { label: 'Fett',          value: totals.fat,     from: 'from-purple-50', to: 'to-purple-100', border: 'border-purple-200', color: 'text-purple-600', num: 'text-purple-900' },
                  { label: 'Ballaststoffe', value: totals.fiber,   from: 'from-green-50',  to: 'to-green-100',  border: 'border-green-200',  color: 'text-green-600',  num: 'text-green-900'  },
                ].map(s => (
                  <div key={s.label} className={`stat-card bg-gradient-to-br ${s.from} ${s.to} rounded-xl p-4 border ${s.border}`}>
                    <p className={`${s.color} text-xs font-semibold uppercase tracking-wide mb-1`}>{s.label}</p>
                    <p className={`text-2xl font-bold ${s.num} mono`}>{Math.round(s.value)}g</p>
                  </div>
                ))}
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
    </div>
  );
};

export default KalorienTracker;
