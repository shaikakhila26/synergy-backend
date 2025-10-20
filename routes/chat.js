// synergy-backend/src/routes/chat.js
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { authenticateSupabase } from '../middleware/auth.js';

dotenv.config();

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// GET messages for a workspace
// GET /api/chat/messages?workspaceId=...
router.get('/messages', async (req, res) => {
  const { workspaceId, dmWith } = req.query;
  try {
    let data, error;
    if (workspaceId) {
      ({ data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true }));
    } else if (dmWith && req.headers.authorization) {
      // dmWith expects the other user's id, auth required
      // authenticate token and get user id from token
      const token = req.headers.authorization.split(' ')[1];
      // Here we simply decode by calling supabase.auth.getUser via service key not recommended; require auth middleware
      const { data: userData, error: _ } = await supabase.auth.getUser(token);
      const me = userData?.user;
      if (!me) return res.status(401).json({ success:false, message:'Unauthorized' });

      const [a,b] = [me.id, dmWith].sort();
      // We store DMs without workspace_id in this design. We fetch messages where sender/recipient match.
      // If your schema stores recipient, adjust accordingly. Here we fetch messages where thread_id or sender/recipient logic applied.
      ({ data, error } = await supabase
        .from('messages')
        .select('*')
        .or(
          `and(sender_id.eq.${a},thread_id.is.null),and(sender_id.eq.${b},thread_id.is.null)`
        )
        .order('created_at', { ascending: true }));
    } else {
      return res.status(400).json({ success: false, message: 'workspaceId or dmWith required' });
    }

    if (error) return res.status(400).json({ success: false, message: error.message });

    res.json({ success: true, data: { messages: data } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
