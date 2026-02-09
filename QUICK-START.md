# ⚡ QUICK START - NETLIFY DEPLOYMENT

## 🎯 **IN 5 MINUTEN LIVE!**

### **Schritt 1: Google API-Key holen (1 Min)**
https://aistudio.google.com/app/apikey → "Create API Key" → Kopieren

---

### **Schritt 2: Zu GitHub pushen (2 Min)**
```bash
cd kalorienzaehler-netlify-final
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/DEIN-USERNAME/kalorienzaehler.git
git push -u origin main
```

---

### **Schritt 3: Auf Netlify deployen (2 Min)**
1. https://app.netlify.com
2. "Import from Git" → GitHub → Repository wählen
3. **WICHTIG:** Environment Variable hinzufügen:
   - Key: `GOOGLE_API_KEY`
   - Value: Dein Google API-Key
4. "Deploy"

---

## ✅ **FERTIG!**

Nach 2-3 Minuten ist deine App live auf:
```
https://deine-site.netlify.app
```

---

## 📖 **Ausführliche Anleitung:**

Siehe: **NETLIFY-ANLEITUNG.md**

---

## 🆓 **KOSTEN:**

- Netlify: **KOSTENLOS**
- Google Gemini: **KOSTENLOS**
- GitHub: **KOSTENLOS**

**Total: 0€** 🎉
