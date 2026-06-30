// Public Supabase config — same project as quay-clock + quay-leads-dashboard.
// Both values are intended to be public. Row-level access is gated by
// Postgres RLS on every table (super/admin staff only).
window.QUAY = {
  SUPABASE_URL: "https://dqszbqiimbfvmmnpgpsb.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxc3picWlpbWJmdm1tbnBncHNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NDk4OTQsImV4cCI6MjA5NjQyNTg5NH0.M9RQnJEidyIMZAwbELTSPakiSnvuWBdHTjD7nuOdCZY",
  AUTH_EMAIL_DOMAIN: "quay1.local",
};
