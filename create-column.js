const { createClient } = require('@supabase/supabase-js');

const url = 'https://pfmafymhudbstxwrwtlu.supabase.co';
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmbWFmeW1odWRic3R3cnd0bHUiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiZXhwIjoxNzA3NjYyMzUwfQ.ObS-oF5HK9uRFwvGCNLqnGmGKzLq0YLYnl0OthzY9Sc';
const supabase = createClient(url, serviceKey);

async function createColumn() {
  try {
    console.log('Attempting to create assigned_cost_center_id column...\n');
    
    // First, let's check if the column already exists
    const checkQuery = `
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'receipt_items' 
      AND column_name = 'assigned_cost_center_id'
    `;
    
    // Try using RPC to check
    const { data: checkData, error: checkError } = await supabase.rpc('exec_sql', { query: checkQuery }).catch(() => ({ error: 'RPC unavailable' }));
    
    if (checkError) {
      console.log('RPC not available, trying direct ALTER TABLE...\n');
    } else if (checkData && checkData.length > 0) {
      console.log('✓ Column already exists!');
      console.log(checkData);
      return;
    }
    
    // Now try to create the column
    const createQuery = `
      ALTER TABLE receipt_items 
      ADD COLUMN IF NOT EXISTS assigned_cost_center_id uuid 
      REFERENCES cost_centers(id) ON DELETE SET NULL;
    `;
    
    const { data, error } = await supabase.rpc('exec_sql', { query: createQuery }).catch(() => ({ error: 'RPC unavailable' }));
    
    if (error && error !== 'RPC unavailable') {
      console.log('Error creating column:', error);
      return;
    }
    
    if (data) {
      console.log('✓ Column created successfully!');
      console.log('Response:', data);
    } else {
      console.log('? RPC not available - trying REST API...\n');
      // Test REST API to see if column works now
      const testResult = await fetch(url + '/rest/v1/receipt_items?select=assigned_cost_center_id&limit=1', {
        headers: { 'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmbWFmeW1odWRic3R3cnd0bHUiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTY5MjExMDM1MCwiZXhwIjoxNzA3NjYyMzUwfQ.gS1qYLKp_QZCQJIEhFMX0rGKwIhfHU1x0E4z0tRUjLs' }
      });
      
      if (testResult.status === 200) {
        console.log('✓ Column EXISTS in database!');
        const data = await testResult.json();
        if (data.length > 0) {
          console.log('Sample data:', data[0]);
        }
      } else {
        console.log('✗ Column does NOT exist yet');
        console.log('Status:', testResult.status);
        console.log('You must run this SQL in Supabase:');
        console.log(createQuery);
      }
    }
  } catch (e) {
    console.log('Exception:', e.message);
    console.log(e);
  }
}

createColumn();
