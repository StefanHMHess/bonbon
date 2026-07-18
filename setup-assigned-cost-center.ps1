# SQL Query zum Hinzufügen der assigned_cost_center_id Spalte
# Bitte kopieren Sie folgende SQL-Befehle in die Supabase SQL-Konsole:
# https://supabase.com/dashboard/project/pfmafymhudbstxwrwtlu/sql/new

# SQL Query 1: Spalte hinzufügen
$sql1 = @"
ALTER TABLE receipt_items 
ADD COLUMN IF NOT EXISTS assigned_cost_center_id uuid 
REFERENCES cost_centers(id) ON DELETE SET NULL;
"@

# SQL Query 2: Index erstellen
$sql2 = @"
CREATE INDEX IF NOT EXISTS idx_receipt_items_assigned_cost_center 
ON receipt_items(assigned_cost_center_id);
"@

Write-Host "╔════════════════════════════════════════════════════════════════════╗"
Write-Host "║  BonBox - Kostenträger-Spalte erstellen                           ║"
Write-Host "╚════════════════════════════════════════════════════════════════════╝"
Write-Host ""
Write-Host "Schritt 1: Öffnen Sie Supabase SQL-Editor"
Write-Host "URL: https://supabase.com/dashboard/project/pfmafymhudbstxwrwtlu/sql/new"
Write-Host ""
Write-Host "Schritt 2: Kopieren Sie folgende SQL und führen Sie sie aus:"
Write-Host ""
Write-Host "┌─ SQL Query 1 ─────────────────────────────────────────────────────┐"
Write-Host $sql1
Write-Host "└──────────────────────────────────────────────────────────────────┘"
Write-Host ""
Write-Host "┌─ SQL Query 2 (optional, für Performance) ──────────────────────────┐"
Write-Host $sql2
Write-Host "└──────────────────────────────────────────────────────────────────┘"
Write-Host ""
Write-Host "Schritt 3: Nach erfolgreichem Ausführen können Sie in der App"
Write-Host "           Kostenträger bei Positionen auswählen und speichern."
Write-Host ""

# Try to open the Supabase console
$url = "https://supabase.com/dashboard/project/pfmafymhudbstxwrwtlu/sql/new"
Write-Host "Öffne Supabase-Konsole in Browser..."
Start-Process $url
