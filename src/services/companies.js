import { supabase } from "../lib/supabase";

export async function registerCompany({ email, password, name }) {
  if (!supabase) throw new Error("Add your Supabase URL and publishable key to .env first.");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { company_name: name } },
  });
  if (error) throw error;
  // Do not insert into public.company until its exact columns, foreign key,
  // and RLS policy are confirmed. Auth metadata alone is not a company record.
  return data;
}

export async function signInCompany({ email, password }) {
  if (!supabase) throw new Error("Add your Supabase URL and publishable key to .env first.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
