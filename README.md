# BonBon

BonBon ist eine Haushaltsbuch-App im Stil von Immo-manager:

- Einkaufsbelege hochladen/scannen
- KI-Extraktion von Positionen und Beträgen
- Automatische Sammlung im Haushaltsbuch
- Positionen nachträglich als Geschenk markieren
- Geschenk-Positionen laufen in ein separates Konto
- Backend mit Supabase (Postgres, Storage, Edge Functions)

## 1) Setup

```bash
cd bonbon
npm install
cp .env.example .env
```

`.env` ausfüllen:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DEFAULT_HOUSEHOLD_ID` (UUID aus `households`)

## 2) Supabase vorbereiten

1. SQL aus `supabase_schema.sql` im Supabase SQL Editor ausführen.
2. Optional/empfohlen für Kostenübersichten:
	- `supabase_household_cost_groups.sql`
	- `supabase_family_accounts_allocations.sql`
3. Für Login + Benutzerfreigabe zusätzlich ausführen:
	- `supabase_user_access.sql`
4. Für Fremdwährung + EUR-Umrechnung zusätzlich ausführen:
	- `supabase_currency_conversion.sql`
5. Für Beleg-Löschen + erneute Analyse zusätzlich ausführen:
	- `supabase_receipt_cleanup.sql`
6. Storage Bucket `receipts` erstellen (privat).
7. Edge Function deployen:

```bash
supabase functions deploy bonbon-extract-receipt
supabase secrets set OPENAI_API_KEY=... OPENAI_MODEL=gpt-4.1-mini
```

Hinweis: Für die Function müssen auch `SUPABASE_URL` und `SUPABASE_SERVICE_ROLE_KEY` in der Supabase Function Umgebung vorhanden sein.

## 3) Starten

```bash
npm run dev
```

## 4) Netlify Deployment

BonBon kann als statisches Vite-Frontend auf Netlify deployed werden.

1. Repository mit Netlify verbinden.
2. Build command: `npm run build`
3. Publish directory: `dist`
4. Environment variables setzen:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_DEFAULT_HOUSEHOLD_ID`

Die Datei [netlify.toml](netlify.toml) ist bereits vorbereitet und der SPA-Fallback liegt in [public/_redirects](public/_redirects).

## Kernablauf

1. Beleg hochladen
2. Datei landet im Supabase Storage
3. Edge Function liest den Beleg mit Vision-KI aus
4. Positionen werden in `receipt_items` gespeichert und bei Fremdwährung direkt in EUR umgerechnet
5. Bei `is_gift = true` läuft die Position ins Geschenke-Konto

## Fremdwährung

- Das OCR versucht die Originalwährung zu erkennen, inklusive TRY/TL.
- In der Positionsliste kannst du pro Position Betrag und Währung nachträglich ändern.
- Die EUR-Summe und die Personenkonten-Verteilung werden dabei automatisch nachgezogen.

## Neue Belege

- Beim Beleg-Upload kannst du das Personenkonto für neue Positionen vorab auswählen.
- Nach der Analyse werden die Positionen automatisch diesem Konto zugeordnet.
- Einzelne Positionen kannst du danach wie bisher auf andere Personenkonten umstellen.

## Produktionshinweis

Die Beispiel-RLS-Policies sind offen (`using (true)`) damit der MVP sofort läuft. Für Produktion sollten Policies auf `auth.uid()` und Household-Mitgliedschaften eingeschränkt werden.

## Benutzerfreigabe

- Login erfolgt per Supabase Magic Link (E-Mail).
- Jeder neue Nutzer landet in `user_access` mit Status `pending`.
- Admins sehen in der App die offenen Freigaben und können auf `approved` setzen.
- Ersten Admin in Supabase SQL Editor per `update public.user_access ... is_admin = true` setzen.
- Alternativ kann sich der erste angemeldete Nutzer einmalig in der App selbst freischalten
	über "Als ersten Admin freischalten" (nur solange noch kein freigegebener Admin existiert).
