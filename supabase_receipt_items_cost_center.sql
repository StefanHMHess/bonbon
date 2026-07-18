-- Create assigned_cost_center_id column in receipt_items
ALTER TABLE receipt_items 
ADD COLUMN IF NOT EXISTS assigned_cost_center_id uuid 
REFERENCES cost_centers(id) ON DELETE SET NULL;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_receipt_items_assigned_cost_center 
ON receipt_items(assigned_cost_center_id);
