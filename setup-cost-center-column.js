#!/usr/bin/env node

const https = require('https');

const supabaseUrl = 'https://pfmafymhudbstxwrwtlu.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmbWFmeW1odWRic3R3cnd0bHUiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjkyMTEwMzUwLCJleHAiOjE3MDc2NjIzNTB9.h7Y0VqzAKjnJaKWtC0wXH5jqNm--oL-pCk0bYcwvP0s';

const sql = `ALTER TABLE receipt_items 
ADD COLUMN IF NOT EXISTS assigned_cost_center_id uuid 
REFERENCES cost_centers(id) ON DELETE SET NULL;`;

const requestBody = JSON.stringify({ query: sql });

const options = {
  hostname: 'pfmafymhudbstxwrwtlu.supabase.co',
  port: 443,
  path: '/rest/v1/sql',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(requestBody),
  }
};

const req = https.request(options, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}`);
    console.log('Response:', data);
    
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log('\n✓ SUCCESS! Die Spalte assigned_cost_center_id wurde erfolgreich erstellt.');
      console.log('Sie können jetzt in der App Kostenträger bei Positionen auswählen.');
    } else {
      console.log('\n✗ FEHLER! Die Spalte konnte nicht erstellt werden.');
      console.log('Bitte versuchen Sie, die SQL direkt in der Supabase-Konsole auszuführen:');
      console.log('https://supabase.com/dashboard/project/pfmafymhudbstxwrwtlu/sql/new');
    }
  });
});

req.on('error', (error) => {
  console.error('Request-Fehler:', error);
});

console.log('Versuche, die assigned_cost_center_id Spalte zu erstellen...\n');
req.write(requestBody);
req.end();
