import { SupabaseClient } from "@supabase/supabase-js";

export interface Conversation {
  id: string;
  created_at: string;
}

export type MessageRole = "user" | "assistant";

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
}

/** Creates a new conversation row and returns it. */
export async function createConversation(
  db: SupabaseClient
): Promise<Conversation> {
  const { data, error } = await db
    .from("conversations")
    .insert({})
    .select()
    .single<Conversation>();

  if (error) throw new Error(`createConversation: ${error.message}`);
  return data;
}

/** Inserts a message and returns it. */
export async function insertMessage(
  db: SupabaseClient,
  conversationId: string,
  role: MessageRole,
  content: string
): Promise<Message> {
  const { data, error } = await db
    .from("messages")
    .insert({ conversation_id: conversationId, role, content })
    .select()
    .single<Message>();

  if (error) throw new Error(`insertMessage: ${error.message}`);
  return data;
}

/** Returns all messages for a conversation, ordered oldest-first. */
export async function getMessages(
  db: SupabaseClient,
  conversationId: string
): Promise<Message[]> {
  const { data, error } = await db
    .from("messages")
    .select()
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .returns<Message[]>();

  if (error) throw new Error(`getMessages: ${error.message}`);
  return data;
}
