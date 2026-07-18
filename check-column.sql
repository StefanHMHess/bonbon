-- Check if assigned_cost_center_id column exists
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'receipt_items' AND column_name = 'assigned_cost_center_id';

-- If not found above, let's see all columns in receipt_items
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'receipt_items'
ORDER BY ordinal_position;
