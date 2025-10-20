// synergy-backend/middleware/auth.js
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // Use service role key for server-side auth checks
);

export const authenticateSupabase = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.log("No auth header or invalid format");
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const token = authHeader.split(' ')[1];
    console.log("Incoming token:", token.slice(0,30) + '...');
    if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });

    // Verify session token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    console.log("Supabase getUser result:", user, error);
    if (error || !user) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    req.user = user; // Attach user info to request
    next();
  } catch (err) {
    console.error("Auth middleware error:", err.message);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
