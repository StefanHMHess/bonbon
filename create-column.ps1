# Execute SQL via Supabase REST API to add assigned_cost_center_id column
$supabaseUrl = 'https://pfmafymhudbstxwrwtlu.supabase.co'
$apiKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmbWFmeW1odWRic3R3cnd0bHUiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTY5MjExMDM1MCwiZXhwIjoxNzA3NjYyMzUwfQ.gS1qYLKp_QZCQJIEhFMX0rGKwIhfHU1x0E4z0tRUjLs'

$sql = "ALTER TABLE receipt_items ADD COLUMN IF NOT EXISTS assigned_cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL; CREATE INDEX IF NOT EXISTS idx_receipt_items_assigned_cost_center ON receipt_items(assigned_cost_center_id);"

$headers = @{
  'Authorization' = "Bearer $apiKey"
  'Content-Type' = 'application/json'
}

$body = @{
  query = $sql
} | ConvertTo-Json

Write-Host "Executing SQL to add assigned_cost_center_id column..."

try {
  $response = Invoke-RestMethod -Uri "$supabaseUrl/rest/v1/sql" -Method Post -Headers $headers -Body $body
  Write-Host "Success!"
  $response
} catch {
  Write-Host "Error: $($_.Exception.Message)"
}
