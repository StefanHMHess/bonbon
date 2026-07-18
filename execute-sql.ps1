# Supabase SQL execution script
$url = "https://pfmafymhudbstxwrwtlu.supabase.co/rest/v1/sql"
$serviceRoleKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmbWFmeW1odWRic3R3cnd0bHUiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjkyMTEwMzUwLCJleHAiOjE3MDc2NjIzNTB9.h7Y0VqzAKjnJaKWtC0wXH5jqNm--oL-pCk0bYcwvP0s"

$headers = @{
    Authorization = "Bearer $serviceRoleKey"
    "Content-Type" = "application/json"
}

$body = @{
    query = "ALTER TABLE receipt_items ADD COLUMN IF NOT EXISTS assigned_cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL;"
} | ConvertTo-Json

Write-Host "Executing SQL to add assigned_cost_center_id column..."

try {
    $response = Invoke-RestMethod -Uri $url -Method Post -Headers $headers -Body $body -ErrorAction Stop
    Write-Host "Success!"
    $response
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
