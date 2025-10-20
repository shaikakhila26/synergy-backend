import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function getTaskLists(workspaceId) {
  const { data, error } = await supabase
    .from("task_lists")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("position", { ascending: true });

  if (error) throw new Error(error.message);
  return data;
}

export async function getTasks(listId) {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("list_id", listId)
    .order("position", { ascending: true });

  if (error) throw new Error(error.message);
  return data;
}

export async function createTaskList(workspaceId, title,position = 0) {
  const { data, error } = await supabase
    .from("task_lists")
    .insert([{ workspace_id: workspaceId, title ,position}])
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function createTask(listId, title, description, assigned_to,workspaceId) {
  const { data, error } = await supabase
    .from("tasks")
    .insert([{ list_id: listId, title, description, assigned_to,position :0, workspace_id: workspaceId }])
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateTaskPositions(tasks) {
  const updates = tasks.map(t => ({
    id: t.id,
    position: t.position,
    list_id: t.list_id,
  }));

  const { error } = await supabase
    .from("tasks")
    .upsert(updates, { onConflict: "id" });

  if (error) throw new Error(error.message);
}
