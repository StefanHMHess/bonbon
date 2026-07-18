const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://pfmafymhudbstxwrwtlu.supabase.co';
const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmbWFmeW1odWRic3R3cnd0bHUiLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjkyMTEwMzUwLCJleHAiOjE3MDc2NjIzNTB9.h7Y0VqzAKjnJaKWtC0wXH5jqNm--oL-pCk0bYcwvP0s';

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function addColumn() {
  console.log('Attempting to add assigned_cost_center_id column...');
  
  try {
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `ALTER TABLE receipt_items 
            ADD COLUMN IF NOT EXISTS assigned_cost_center_id uuid 
            REFERENCES cost_centers(id) ON DELETE SET NULL;`
    });
    
    if (error) {
      console.error('Error:', error);
    } else {
      console.log('Success!', data);
    }
  } catch (err) {
    console.error('Exception:', err.message);
  }
}

addColumn();
