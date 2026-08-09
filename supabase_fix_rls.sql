-- BonBox: Fix missing Row-Level Security on public tables
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/pfmafymhudbstxwrwtlu/sql/new

-- Step 1: Check which tables are missing RLS (diagnostic query)
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false;

-- Step 2: Enable RLS on all public tables that are missing it
ALTER TABLE IF EXISTS public.households           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.receipts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.receipt_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.family_accounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.receipt_item_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.household_cost_groups    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.settlement_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.user_access              ENABLE ROW LEVEL SECURITY;

-- cost_centers table (if it exists separately from family_accounts)
ALTER TABLE IF EXISTS public.cost_centers         ENABLE ROW LEVEL SECURITY;

-- Catch-all: enable RLS on any remaining public table that still has it disabled
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND rowsecurity = false
  LOOP
    RAISE NOTICE 'Enabling RLS on table: %', tbl;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
  END LOOP;
END;
$$;

-- Step 3: Ensure cost_centers has policies if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'cost_centers') THEN
    EXECUTE $policy$
      DROP POLICY IF EXISTS cost_centers_select_all ON public.cost_centers;
      DROP POLICY IF EXISTS cost_centers_insert_all ON public.cost_centers;
      DROP POLICY IF EXISTS cost_centers_update_all ON public.cost_centers;
      DROP POLICY IF EXISTS cost_centers_delete_all ON public.cost_centers;

      CREATE POLICY cost_centers_select_all ON public.cost_centers FOR SELECT USING (true);
      CREATE POLICY cost_centers_insert_all ON public.cost_centers FOR INSERT WITH CHECK (true);
      CREATE POLICY cost_centers_update_all ON public.cost_centers FOR UPDATE USING (true) WITH CHECK (true);
      CREATE POLICY cost_centers_delete_all ON public.cost_centers FOR DELETE USING (true);
    $policy$;
  END IF;
END;
$$;

-- Step 4: Verify – this query should return 0 rows after running the script above.
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false;
