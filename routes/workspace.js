// routes/workspace.js
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { authenticateSupabase } from '../middleware/auth.js';
import { createTaskList } from '../models/task.js';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';



const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const ALLOWED_ROLES = ['owner', 'admin', 'member'];

const resend = new Resend(process.env.RESEND_API_KEY);

router.use((req,res,next)=>{
  console.log(req.method, req.url);
  next();
});

// Create workspace and add owner as member
router.post('/create', authenticateSupabase, async (req, res) => {
  console.log("Creating workspace for user:", req.user.id, "body:", req.body);
  const { name, is_public } = req.body;
  const owner_id = req.user.id;

  if (!name) return res.status(400).json({ success: false, message: 'Workspace name is required' });

  const invite_code = uuidv4();

  try {
    const { data, error } = await supabase
      .from('workspaces')
      .insert([{ name, owner_id, is_public: !!is_public , invite_code }])
      .select();

    if (error) return res.status(400).json({ success: false, message: error.message });
console.log("Create workspace request body:", req.body);

    const workspaceId = data[0].id;

    // Add owner as member
    const { error: memError } = await supabase
      .from('workspace_members')
      .insert([{ workspace_id: workspaceId, user_id: owner_id, role: 'owner', invited_by: owner_id }]);

    if (memError) return res.status(500).json({ success: false, message: memError.message });

    res.json({ success: true, message: 'Workspace created successfully', data: { workspace: data[0], invite_code } });
    const defaultLists = ["To Do", "In Progress", "Done"];
for (let i = 0; i < defaultLists.length; i++) {
  await createTaskList(workspaceId, defaultLists[i], i);
}
  } catch (err) {
    console.error("create workspace error:",err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Join workspace by invite code
router.post('/join', authenticateSupabase, async (req, res) => {
  const { invite_code } = req.body;
  const user_id = req.user.id;

  if (!invite_code) return res.status(400).json({ success: false, message: 'Invite code is required' });

  try {
    const { data: workspace, error } = await supabase
      .from('workspaces')
      .select('id')
      .eq('invite_code', invite_code)
      .maybeSingle();

    if (error || !workspace?.id) return res.status(404).json({ success: false, message: 'Invalid invite code' });

    const { data: member } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspace.id)
      .eq('user_id', user_id)
      .maybeSingle();

    if (member?.id) return res.status(409).json({ success: false, message: 'Already a member' });

    const { error: addError } = await supabase
      .from('workspace_members')
      .insert([{ workspace_id: workspace.id, user_id, role: 'member' }]);

    if (addError) return res.status(500).json({ success: false, message: addError.message });

    res.json({ success: true, message: 'Joined workspace successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Search public workspaces by name (no auth needed)
router.get('/search', async (req, res) => {
  const { q } = req.query;

  try {
    const { data, error } = await supabase
      .from('workspaces')
      .select('*')
      .ilike('name', `%${q}%`)
      .eq('is_public', true);

    if (error) return res.status(400).json({ success: false, message: error.message });

    res.json({ success: true, data: { workspaces: data } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Add member to workspace (admin only)
router.post('/:workspaceId/add-member', authenticateSupabase, async (req, res) => {
  const { workspaceId } = req.params;
  const admin_id = req.user.id;
  const { user_id, role } = req.body;

  if (!ALLOWED_ROLES.includes(role)) return res.status(400).json({ success: false, message: 'Invalid role' });

  try {
    const { data: admin } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', admin_id)
      .maybeSingle();

    if (!admin || !['owner', 'admin'].includes(admin.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await supabase
      .from('workspace_members')
      .insert([{ workspace_id: workspaceId, user_id, role, invited_by: admin_id }]);

    res.json({ success: true, message: 'Member added successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// Change member role (admin only)
router.patch('/:workspaceId/member/:userId/role', authenticateSupabase, async (req, res) => {
  const { workspaceId, userId } = req.params;
  const admin_id = req.user.id;
  const { new_role } = req.body;

  if (!ALLOWED_ROLES.includes(new_role)) return res.status(400).json({ success: false, message: 'Invalid role' });

  try {
    const { data: admin } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', admin_id)
      .maybeSingle();

    if (!admin || !['owner', 'admin'].includes(admin.role)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    await supabase
      .from('workspace_members')
      .update({ role: new_role })
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId);

    res.json({ success: true, message: 'Role updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});


// Send email invite
router.post('/:workspaceId/invite', authenticateSupabase, async (req, res) => {
  const { workspaceId } = req.params;
  const { email } = req.body;
  const inviterId = req.user.id;

  if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

  try {
    // Check if workspace exists
    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .select('name')
      .eq('id', workspaceId)
      .maybeSingle();
    if (wsError || !workspace) return res.status(404).json({ success: false, message: 'Workspace not found' });

    // Generate token for invite link
    const token = uuidv4();

    // Save to workspace_invites table
    const { error: insertError } = await supabase
      .from('workspace_invites')
      .insert([{ workspace_id: workspaceId, email, invited_by: inviterId, token }]);
    if (insertError) return res.status(500).json({ success: false, message: insertError.message });

    // Send email
    /*
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'false', // true for 465, false for other ports
      requireTLS: true,   
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });*/

    const inviteLink = `${process.env.CLIENT_URL}/join/${token}`;

    /*await transporter.sendMail({
      from: `"${workspace.name}" <${process.env.SMTP_USER}>`,
      to: email,
      subject: `You're invited to join workspace "${workspace.name}"`,
      html: `
        <p>Hello,</p>
        <p>${req.user.email} invited you to join the workspace <b>${workspace.name}</b>.</p>
        <p>Click here to join: <a href="${inviteLink}">${inviteLink}</a></p>
        <p>If you didn't expect this invite, ignore this email.</p>
      `,
    });*/

    // ✅ Send email using Resend
    await resend.emails.send({
      from: `Synergy <${process.env.RESEND_FROM}>`,
      to: email,
      subject: `You're invited to join "${workspace.name}" on Synergy`,
      html: `
        <p>Hello 👋,</p>
        <p><b>${req.user.email}</b> has invited you to join the workspace <b>${workspace.name}</b> on Synergy.</p>
        <p>Click below to accept the invite:</p>
        <p><a href="${inviteLink}" target="_blank" style="color:#007bff;">Join Workspace</a></p>
        <p>If you weren't expecting this invite, you can ignore this email.</p>
        <br/>
        <p>— The Synergy Team</p>
      `,
    });

    res.json({ success: true, message: 'Invite sent successfully' });
  } catch (err) {
    console.error(err);
    console.log("Error sending invite:", err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});


// Join workspace via invite token
router.post('/join-by-token', authenticateSupabase, async (req, res) => {
  const { token } = req.body;
  const user_id = req.user.id;

  if (!token) return res.status(400).json({ success: false, message: 'Token is required' });

  try {
    const { data: invite } = await supabase
      .from('workspace_invites')
      .select('workspace_id, email')
      .eq('token', token)
      .maybeSingle();

    if (!invite?.workspace_id) return res.status(404).json({ success: false, message: 'Invalid token' });

    // Check if user is already a member
    const { data: member } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', invite.workspace_id)
      .eq('user_id', user_id)
      .maybeSingle();

    if (member?.id) return res.status(409).json({ success: false, message: 'Already a member' });

   await supabase
  .from("workspace_members")
  .insert([{ workspace_id: invite.workspace_id, user_id, role: "member", invited_by: null }]);

  await supabase
  .from('workspace_invites')
  .update({ accepted: true })
  .eq('token', token);


res.json({
  success: true,
  message: "Joined workspace successfully",
  workspace_id: invite.workspace_id,
});

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});



export default router;
