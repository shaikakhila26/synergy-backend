// backend/routes/auth.js
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

dotenv.config();

const router = express.Router();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

// Rate limiter
const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 min
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_, res) => res.status(429).json({ success: false, message: "Too many requests, try again later." }),
});

// -------------------- SIGNUP --------------------
router.post('/signup', authLimiter, async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: "Email and password are required." });

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${CLIENT_URL}/login`,
        data: { name },
      },
    });

    if (error) {
      console.error("Supabase Signup error:", error.message);
      return res.status(400).json({ success: false, message: error.message });
    }

    if (data.user) {
      await supabase.from('users').upsert({
        id: data.user.id,
        email: data.user.email,
        name: name || (data.user.email ? data.user.email.split('@')[0] : 'User'),
      });
    }

    res.status(201).json({ success: true, message: "Signup successful! Please check your email to confirm your account." });
  } catch (err) {
    console.error("Signup error:", err.message);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
});

// -------------------- FORGOT PASSWORD --------------------
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: "Email is required." });

  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${CLIENT_URL}/reset-password`,
    });
    if (error) return res.status(400).json({ success: false, message: error.message });

    res.json({ success: true, message: "If this email is registered, you will receive reset instructions." });
  } catch (err) {
    console.error("Forgot password error:", err.message);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
});

// -------------------- RESET PASSWORD --------------------
router.post('/reset-password', authLimiter, async (req, res) => {
  const { access_token, newPassword } = req.body;
  if (!access_token || !newPassword) return res.status(400).json({ success: false, message: "Missing required fields." });

  try {
    const { data, error } = await supabase.auth.updateUser({ access_token, password: newPassword });
    if (error) return res.status(400).json({ success: false, message: error.message });

    res.json({ success: true, message: "Password successfully updated." });
  } catch (err) {
    console.error("Reset password error:", err.message);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
});

export default router;
