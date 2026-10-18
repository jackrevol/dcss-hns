// Publishable client coordinates; password-verified RPCs enforce authorization
// in supabase/cloud-saves.sql. Never put a secret here.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://xviinjuhtvzgalqupddc.supabase.co'
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_aSbsP4SQXpitqENyzmi2kg_VETbvi8M'
