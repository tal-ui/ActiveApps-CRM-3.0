import { createClient } from "@supabase/supabase-js";

// AA CRM project (Supabase). The anon key is a publishable client key —
// all data access is protected by Row Level Security (authenticated users only).
const SUPABASE_URL = "https://ndzvqldluzfstowhhkvd.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5kenZxbGRsdXpmc3Rvd2hoa3ZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2OTkxMTMsImV4cCI6MjA5MDI3NTExM30.YSNvdwoE9Qo_QnHzXf4HrmC8b4hLOagfBDPhy8DILhk";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
