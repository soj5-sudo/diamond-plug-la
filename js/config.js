// ===== Supabase configuration =====
// Your project — already wired in.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://svjynbciageosjortbyc.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2anluYmNpYWdlb3Nqb3J0YnljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1MDQ4NjQsImV4cCI6MjA5NzA4MDg2NH0.M3yLOv_KqFZ3aTfvaeuR2ky82IZsru10QCdYER3OqsQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Hugging Face free inference (for the design chatbot). No key needed for public router.
export const HF_TOKEN = ''; // optional
export const HF_MODEL = 'mistralai/Mistral-7B-Instruct-v0.2';
