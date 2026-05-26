import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config";

let supabase: SupabaseClient;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(config.supabase.url, config.supabase.serviceKey);
  }
  return supabase;
}
