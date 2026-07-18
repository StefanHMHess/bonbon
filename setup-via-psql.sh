#!/bin/bash

# Supabase PostgreSQL Connection Script
# Dieses Skript verbindet sich mit deiner Supabase-PostgreSQL-Datenbank und erstellt die assigned_cost_center_id Spalte

# Supabase Verbindungsdaten
PGHOST="aws-0-eu-west-1.pooler.supabase.com"
PGPORT="6543"
PGDATABASE="postgres"
PGUSER="postgres.pfmafymhudbstxwrwtlu"
PGPASSWORD="your-password-here"

# SQL-Befehle
SQL="
ALTER TABLE receipt_items 
ADD COLUMN IF NOT EXISTS assigned_cost_center_id uuid 
REFERENCES cost_centers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_receipt_items_assigned_cost_center 
ON receipt_items(assigned_cost_center_id);
"

# Führe SQL aus
echo "Verbinde mit Supabase PostgreSQL..."
psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -c "$SQL"

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ SUCCESS! Die Spalte wurde erstellt."
else
    echo ""
    echo "✗ FEHLER! Bitte überprüfen Sie die Verbindungsdaten."
fi
