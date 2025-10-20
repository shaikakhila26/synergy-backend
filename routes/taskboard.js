import express from "express";
import { authenticateSupabase as authenticate } from "../middleware/auth.js";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();


import {
  getTaskLists,
  getTasks,
  createTaskList,
  createTask,
  updateTaskPositions,
} from "../models/task.js";

const router = express.Router();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ✅ Get all lists + tasks for a workspace
//router.get("/:workspaceId", authenticate, async (req, res) => {
// routes/taskboard.js
router.get('/:workspaceId', async (req, res) => {
    console.log("Fetching taskboard for workspace:", req.params.workspaceId);
  const { workspaceId } = req.params;

  // fetch all lists for this workspace
  const { data: lists, error: listError } = await supabase
    .from('task_lists')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('position');

  if (listError) return res.status(400).json({ error: listError.message });

  // fetch all tasks for these lists
  const listIds = lists.map(l => l.id);
  const { data: tasks, error: taskError } = await supabase
    .from('tasks')
    .select('*')
    .in('list_id', listIds)
    .order('position');

    console.log("Fetched lists:", lists);
    console.log("Fetched tasks:", tasks);

  if (taskError) return res.status(400).json({ error: taskError.message });

  // group tasks under their lists
  const listsWithTasks = lists.map(list => ({
    ...list,
    tasks: tasks.filter(t => t.list_id === list.id)
  }));

  res.json({ lists: listsWithTasks });
});


// ✅ Create new list
router.post("/list", authenticate, async (req, res) => {
  const { workspaceId, title } = req.body;
  try {
    const list = await createTaskList(workspaceId, title);
    req.io.to(`workspace:${workspaceId}`).emit("task:list_created", { ...list, tasks :[]});
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Create new task
router.post("/task", authenticate, async (req, res) => {
  const { listId, title, description, assigned_to, workspaceId} = req.body;
  try {
    const task = await createTask(listId, title, description, assigned_to,workspaceId);
    console.log("Create task payload:", req.body);

    req.io.to(`workspace:${workspaceId}`).emit("task:task_created", task);
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Reorder tasks
router.put("/tasks/reorder", authenticate, async (req, res) => {
  try {
    await updateTaskPositions(req.body.tasks);
    req.io.to(req.body.workspaceId).emit("task:tasks_reordered", req.body.tasks);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 🧨 DELETE a task
router.delete("/task/:taskId", authenticate, async (req, res) => {
  const { taskId } = req.params;

  try {
    const { data, error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", taskId)
      .select();

    if (error) throw error;

    // Broadcast to all workspace members
    if (data) {
      const listId = data.list_id;
      req.io.emit("task:task_deleted", { taskId, listId });
    }

    res.json({ success: true, message: "Task deleted successfully", data });
  } catch (err) {
    console.error("Error deleting task:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 🧨 DELETE a list (and its tasks)
router.delete("/list/:listId", authenticate, async (req, res) => {
  const { listId } = req.params;

  try {
    // First delete tasks inside the list
    const { error: tasksError } = await supabase
      .from("tasks")
      .delete()
      .eq("list_id", listId);

    if (tasksError) throw tasksError;

    // Then delete the list itself
    const { data, error: listError } = await supabase
      .from("task_lists")
      .delete()
      .eq("id", listId)
      .select()
      .single();

    if (listError) throw listError;

    // Broadcast to all workspace members
    req.io.emit("task:list_deleted", { listId });

    res.json({ success: true, message: "List deleted successfully", data });
  } catch (err) {
    console.error("Error deleting list:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


export default router;
