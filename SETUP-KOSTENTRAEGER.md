# 🚀 Setup: Kostenträger-Spalte erstellen

Damit die Kostenträger-Auswahl bei Positionen (Sektion 5) funktioniert, muss eine neue Spalte in der Datenbank erstellt werden.

## ⚡ Schnellstart (2 Minuten)

### Schritt 1: SQL-Editor öffnen
Klicken Sie hier: https://supabase.com/dashboard/project/pfmafymhudbstxwrwtlu/sql/new

### Schritt 2: SQL kopieren und einfügen

Kopieren Sie exakt diese SQL (alle Zeilen):

```sql
ALTER TABLE receipt_items 
ADD COLUMN IF NOT EXISTS assigned_cost_center_id uuid 
REFERENCES cost_centers(id) ON DELETE SET NULL;
```

Fügen Sie die SQL in den SQL-Editor ein (großes Textfeld oben auf der Seite).

### Schritt 3: Ausführen
- Drücken Sie: **Cmd+Enter** (Mac) oder **Ctrl+Enter** (Windows)
- Oder klicken Sie auf den grünen "Run" oder "Execute" Button rechts

### Schritt 4: Erfolg prüfen
Sie sollten eine Nachricht sehen wie:
- ✓ "Success" oder
- ✓ "0 rows affected" oder ähnliches

Das bedeutet, die Spalte wurde erfolgreich erstellt!

---

## ✅ Nach dem Setup

Gehen Sie zurück zur BonBox-App:
- http://localhost:5175/
- Laden Sie die Seite neu (F5 oder Cmd+R)
- Gehen Sie zu Sektion 5 "Positionen"
- Sie können jetzt bei jedem Item einen "Kostenträger" auswählen
- Die Auswahl wird automatisch gespeichert ✓

---

## 🆘 Troubleshooting

### Problem: "column... already exists"
Das ist KEIN Fehler! Die Spalte wurde bereits erstellt.
Gehen Sie zurück zur App und aktualisieren Sie die Seite.

### Problem: Andere Fehlermeldung
Kopieren Sie die genaue Fehlermeldung und versuchen Sie:
1. Den SQL-Befehl erneut auszuführen
2. Prüfen Sie, dass Sie im richtigen Projekt sind
3. Laden Sie die Seite neu

### Problem: Dropdown bleibt grau
- Laden Sie die BonBox-App neu (F5)
- Stellen Sie sicher, dass Sie eingeloggt sind
- Überprüfen Sie die Browser-Konsole (F12 → Console) auf Fehler

---

## 📝 Alternative: Index erstellen (optional, für bessere Performance)

Nach der Spalte können Sie optional einen Index erstellen:

```sql
CREATE INDEX IF NOT EXISTS idx_receipt_items_assigned_cost_center 
ON receipt_items(assigned_cost_center_id);
```

Das macht Abfragen schneller, ist aber nicht notwendig.
