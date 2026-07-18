const { createClient } = require('@supabase/supabase-js');

const url = 'https://pfmafymhudbstxwrwtlu.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmbWFmeW1odWRic3R3cnd0bHUiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiZXhwIjoxNzA3NjYyMzUwfQ.ObS-oF5HK9uRFwvGCNLqnGmGKzLq0YLYnl0OthzY9Sc';
const supabase = createClient(url, serviceKey);

async function createColumn() {
  try {
    console.log('Checking if assigned_cost_center_id column exists...\n');
    
    // Test REST API to see if column exists
    console.log('Testing REST API access to receipt_items with assigned_cost_center_id...');
    const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmbWFmeW1odWRic3R3cnd0bHUiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTY5MjExMDM1MCwiZXhwIjoxNzA3NjYyMzUwfQ.gS1qYLKp_QZCQJIEhFMX0rGKwIhfHU1x0E4z0tRUjLs';
    
    try {
      const testResult = await fetch(url + '/rest/v1/receipt_items?select=id,assigned_cost_center_id&limit=1', {
        headers: { 'apikey': anonKey }
      });
      
      if (testResult.status === 200) {
        console.log('✓✓✓ COLUMN EXISTS ✓✓✓');
        const data = await testResult.json();
        if (data && data.length > 0) {
          console.log('Sample row:', JSON.stringify(data[0], null, 2));
        } else {
          console.log('(No rows yet, but column exists)');
        }
        return;
      } else if (testResult.status === 400) {
        console.log('✗ Column does NOT exist (400 error)');
      } else {
        console.log('? Unexpected status:', testResult.status);
        const text = await testResult.text();
        console.log('Response:', text.substring(0, 200));
      }
    } catch (e) {
      console.log('Error testing column:', e.message);
    }
    
    console.log('\n--- ATTEMPTING TO CREATE COLUMN ---\n');
    
    // Try to create using Postgres admin function
    console.log('Creating column via exec_sql RPC...');
    const createResult = await supabase.rpc('exec_sql', { 
      query: `ALTER TABLE receipt_items ADD COLUMN IF NOT EXISTS assigned_cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL;` 
    });
    
    if (createResult.error) {
      console.log('✗ RPC error:', createResult.error.message);
      console.log('\nThe column was NOT created. You must create it manually in Supabase.');
      console.log('Go to: https://supabase.com/dashboard/project/pfmafymhudbstxwrwtlu/sql/new');
      console.log('\nRun this SQL:');
      console.log('---');
      console.log('ALTER TABLE receipt_items ADD COLUMN IF NOT EXISTS assigned_cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL;');
      console.log('---');
    } else {
      console.log('✓ Column created successfully!');
      console.log('Result:', createResult.data);
    }
    
  } catch (e) {
    console.log('✗ Exception:', e.message);
  }
}

createColumn();
