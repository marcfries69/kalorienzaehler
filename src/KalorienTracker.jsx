import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Send, Plus, Trash2, TrendingUp, Flame, ChevronDown } from 'lucide-react';

const KalorienTracker = () => {
  const [meals, setMeals] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [expandedMealId, setExpandedMealId] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    loadMeals();
  }, []);

  const loadMeals = () => {
    try {
      const saved = localStorage.getItem('meals-data');
      if (saved) {
        const data = JSON.parse(saved);
        setMeals(data);
      }
    } catch (error) {
      console.log('Keine gespeicherten Daten gefunden');
    } finally {
      setLoadingInitial(false);
    }
  };

  const saveMeals = (newMeals) => {
    try {
      localStorage.setItem('meals-data', JSON.stringify(newMeals));
    } catch (error) {
      console.error('Fehler beim Speichern:', error);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [meals]);

  const analyzeFoodWithGemini = async (foodText) => {
    try {
      // Rufe Netlify Function auf
      const response = await fetch("/.netlify/functions/analyze-food", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ foodText })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'API-Fehler');
      }

      const result = await response.json();
      return result;

    } catch (error) {
      console.error('Fehler bei der Analyse:', error);
      throw new Error(error.message || 'Konnte Lebensmittel nicht analysieren');
    }
  };

  const handleSubmit = async () => {
    if (!input.trim() || loading) return;

    setLoading(true);
    const userInput = input;
    setInput('');

    try {
      const nutrition = await analyzeFoodWithGemini(userInput);
      const newMeal = {
        id: Date.now(),
        time: new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
        ...nutrition
      };

      const updatedMeals = [...meals, newMeal];
      setMeals(updatedMeals);
      saveMeals(updatedMeals);
    } catch (error) {
      alert('Fehler: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const deleteMeal = (id) => {
    const updatedMeals = meals.filter(m => m.id !== id);
    setMeals(updatedMeals);
    saveMeals(updatedMeals);
  };

  const neuerTag = () => {
    if (meals.length > 0 && !window.confirm('Möchtest du wirklich alle Mahlzeiten löschen und einen neuen Tag beginnen?')) {
      return;
    }
    setMeals([]);
    localStorage.removeItem('meals-data');
  };

  const totals = meals.reduce((acc, meal) => ({
    kcal: acc.kcal + (meal.kcal || 0),
    protein: acc.protein + (meal.protein || 0),
    carbs: acc.carbs + (meal.carbs || 0),
    fat: acc.fat + (meal.fat || 0),
    fiber: acc.fiber + (meal.fiber || 0)
  }), { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

  if (loadingInitial) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 p-4 md:p-8 font-sans">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
        * { font-family: 'Outfit', sans-serif; }
        .mono { font-family: 'Space Mono', monospace; }
        .glass {
          background: rgba(255, 255, 255, 0.7);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.5);
        }
        .stat-card { transition: all 0.3s ease; }
        .stat-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
        }
        .meal-card {
          animation: slideIn 0.4s ease-out forwards;
          opacity: 0;
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .input-glow:focus { box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1); }
      `}</style>

      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center shadow-lg">
              <Flame className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-emerald-600 to-teal-600 bg-clip-text text-transparent">
              Kalorienzähler
            </h1>
          </div>
          <p className="text-slate-600">KI-gestützte Nährwertanalyse mit Google Gemini (Kostenlos!)</p>
          <button
            onClick={neuerTag}
            className="mt-4 px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-sm font-medium transition-colors"
          >
            Neuer Tag
          </button>
        </div>

        <div className="glass rounded-3xl p-6 mb-6 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-slate-800 mb-1">Heute</h2>
              <p className="text-slate-500 text-sm">{new Date().toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
            <div className="text-right">
              <p className="text-5xl font-bold mono bg-gradient-to-r from-orange-500 to-rose-500 bg-clip-text text-transparent">
                {Math.round(totals.kcal)}
              </p>
              <p className="text-slate-500 text-sm font-semibold uppercase tracking-wide">Kalorien</p>
            </div>
          </div>

          <div className="mb-6">
            <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500 ease-out rounded-full"
                style={{ width: `${Math.min((totals.kcal / 2000) * 100, 100)}%` }}
              ></div>
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-xs text-slate-500 font-medium">0 kcal</span>
              <span className="text-xs text-slate-500 font-medium">2000 kcal Ziel</span>
            </div>
          </div>

          <div className="bg-gradient-to-br from-orange-50 to-rose-50 rounded-2xl p-6 mb-4 border border-orange-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-orange-600 text-xs font-semibold uppercase tracking-wide mb-1">Gesamtkalorien</p>
                <p className="text-4xl font-bold text-orange-900 mono">{Math.round(totals.kcal)}</p>
                <p className="text-sm text-orange-700 mt-1">
                  {Math.round((totals.kcal / 2000) * 100)}% des Tagesziels
                </p>
              </div>
              <TrendingUp className="w-16 h-16 text-orange-200 opacity-50" />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="stat-card bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-4 border border-blue-200">
              <p className="text-blue-600 text-xs font-semibold uppercase tracking-wide mb-1">Protein</p>
              <p className="text-2xl font-bold text-blue-900 mono">{Math.round(totals.protein)}g</p>
            </div>
            <div className="stat-card bg-gradient-to-br from-amber-50 to-amber-100 rounded-xl p-4 border border-amber-200">
              <p className="text-amber-600 text-xs font-semibold uppercase tracking-wide mb-1">Kohlenhydrate</p>
              <p className="text-2xl font-bold text-amber-900 mono">{Math.round(totals.carbs)}g</p>
            </div>
            <div className="stat-card bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-4 border border-purple-200">
              <p className="text-purple-600 text-xs font-semibold uppercase tracking-wide mb-1">Fett</p>
              <p className="text-2xl font-bold text-purple-900 mono">{Math.round(totals.fat)}g</p>
            </div>
            <div className="stat-card bg-gradient-to-br from-green-50 to-green-100 rounded-xl p-4 border border-green-200">
              <p className="text-green-600 text-xs font-semibold uppercase tracking-wide mb-1">Ballaststoffe</p>
              <p className="text-2xl font-bold text-green-900 mono">{Math.round(totals.fiber)}g</p>
            </div>
          </div>
        </div>

        <div className="glass rounded-3xl p-6 mb-6 shadow-xl min-h-[300px] max-h-[500px] overflow-y-auto">
          <h3 className="text-xl font-bold text-slate-800 mb-4">Mahlzeiten</h3>
          {meals.length === 0 ? (
            <div className="text-center py-12">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 mx-auto mb-4 flex items-center justify-center">
                <Plus className="w-10 h-10 text-emerald-600" />
              </div>
              <p className="text-slate-500">Noch keine Mahlzeiten erfasst</p>
              <p className="text-slate-400 text-sm mt-1">Gib unten ein Lebensmittel ein, um zu starten</p>
            </div>
          ) : (
            <div className="space-y-3">
              {meals.map((meal, index) => {
                const isExpanded = expandedMealId === meal.id;
                return (
                  <div key={meal.id} className="meal-card bg-white rounded-xl shadow-sm hover:shadow-md transition-all border border-slate-100" style={{ animationDelay: `${index * 0.05}s` }}>
                    <div className="p-4 cursor-pointer" onClick={() => setExpandedMealId(isExpanded ? null : meal.id)}>
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-semibold mono text-slate-500">{meal.time}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                              #{meals.length - index}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold text-slate-800 text-lg">{meal.name}</h4>
                            <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                          </div>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); deleteMeal(meal.id); }} className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="px-3 py-1 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 text-white text-sm font-semibold mono">{Math.round(meal.kcal)} kcal</span>
                        <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-xs font-medium mono">P: {Math.round(meal.protein)}g</span>
                        <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-medium mono">K: {Math.round(meal.carbs)}g</span>
                        <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-700 text-xs font-medium mono">F: {Math.round(meal.fat)}g</span>
                        <span className="px-3 py-1 rounded-full bg-green-100 text-green-700 text-xs font-medium mono">Ballaststoffe: {Math.round(meal.fiber)}g</span>
                      </div>
                    </div>
                    {isExpanded && meal.components && meal.components.length > 0 && (
                      <div className="border-t border-slate-100 p-4 pt-3 bg-slate-50">
                        <h5 className="text-sm font-semibold text-slate-600 mb-3 uppercase tracking-wide">Einzelbestandteile</h5>
                        <div className="space-y-2">
                          {meal.components.map((component, compIndex) => (
                            <div key={compIndex} className="bg-white rounded-lg p-3 border border-slate-200">
                              <div className="flex items-start justify-between mb-2">
                                <div>
                                  <p className="font-medium text-slate-800">{component.name}</p>
                                  <p className="text-xs text-slate-500 mt-0.5">{component.amount}</p>
                                </div>
                                <span className="px-2 py-1 rounded-md bg-orange-100 text-orange-700 text-xs font-semibold mono">{Math.round(component.kcal)} kcal</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 text-xs mono">P: {Math.round(component.protein)}g</span>
                                <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-600 text-xs mono">K: {Math.round(component.carbs)}g</span>
                                <span className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-600 text-xs mono">F: {Math.round(component.fat)}g</span>
                                <span className="px-2 py-0.5 rounded-md bg-green-50 text-green-600 text-xs mono">Bal: {Math.round(component.fiber)}g</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="glass rounded-3xl p-4 shadow-xl">
          <div className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="z.B. 2 Äpfel, 100g Haferflocken mit Milch, Chicken Burger..."
              disabled={loading}
              className="flex-1 px-6 py-4 rounded-2xl border-2 border-slate-200 focus:border-emerald-500 focus:outline-none input-glow disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 placeholder-slate-400"
            />
            <button
              onClick={handleSubmit}
              disabled={loading || !input.trim()}
              className="px-8 py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-xl flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analysiere...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Hinzufügen
                </>
              )}
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-3 text-center">
            KI-gestützte Analyse • Komplett kostenlos mit Google Gemini
          </p>
        </div>
      </div>
    </div>
  );
};

export default KalorienTracker;
