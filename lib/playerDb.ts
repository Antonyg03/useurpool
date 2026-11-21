import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { riotKey } from "./riotId";
import type { AccountType, Region } from "./types";

export interface PlayerRow {
  id: string;
  puuid: string | null;
  account_type: AccountType;
}

export async function findPlayer(
  db: SupabaseClient,
  gameName: string,
  tagLine: string,
  region: Region,
): Promise<PlayerRow | null> {
  const { data, error } = await db
    .from("players")
    .select("id, puuid, account_type")
    .eq("riot_key", riotKey(gameName, tagLine, region))
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function findOrCreatePlayer(
  db: SupabaseClient,
  gameName: string,
  tagLine: string,
  region: Region,
  accountType: AccountType,
): Promise<PlayerRow> {
  const existing = await findPlayer(db, gameName, tagLine, region);
  if (existing) return existing;
  const { data, error } = await db
    .from("players")
    .insert({
      riot_key: riotKey(gameName, tagLine, region),
      game_name: gameName,
      tag_line: tagLine,
      region,
      account_type: accountType,
    })
    .select("id, puuid, account_type")
    .single();
  if (error) throw new Error(error.message);
  return data;
}
