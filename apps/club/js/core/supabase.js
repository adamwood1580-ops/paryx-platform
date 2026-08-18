// Create a reusable connection to the Supabase project.

window.supabaseClient = window.supabase.createClient(
    CONFIG.SUPABASE_URL,
    CONFIG.SUPABASE_ANON_KEY
);

console.log("Supabase client created");
