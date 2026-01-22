// authentication.js
const express = require("express");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const twilio = require("twilio");
const nodemailer = require("nodemailer");

const User = require("./models/User");
const OtpSession = require("./models/OtpSession");

const router = express.Router();

// -------------------- ENV --------------------
const {
  JWT_SECRET,
  JWT_EXPIRES_IN = "7d",

  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER,

  GMAIL_USER,
  GMAIL_APP_PASSWORD,
} = process.env;

const JWT_SECRET_FINAL = JWT_SECRET || "dev_jwt_secret_change_me";

// ✅ FIXED STATIC ADMIN (declare BEFORE routes use it)
const STATIC_ADMIN_EMAIL_FINAL = "sriandhravalmiki@gmail.com";
const STATIC_ADMIN_PASSWORD_FINAL = "rama@2026";

// -------------------- HELPERS --------------------
function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}
function normalizePhone(phone) {
  return String(phone || "").trim();
}
function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
}
function isE164(v) {
  return /^\+\d{8,15}$/.test(String(v || "").trim());
}
function passwordOk(p) {
  return typeof p === "string" && p.length >= 8;
}
function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}
function hashOtp(identifier, otp) {
  return crypto
    .createHash("sha256")
    .update(`${identifier}:${otp}:${JWT_SECRET_FINAL}`)
    .digest("hex");
}
function getStoredPasswordHash(user) {
  return user?.passwordHash || user?.password || null;
}
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET_FINAL, { expiresIn: JWT_EXPIRES_IN });
}

// ✅ EXPORTABLE AUTH MIDDLEWARE
function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ success: false, error: "Missing Bearer token" });

    const decoded = jwt.verify(token, JWT_SECRET_FINAL);
    req.auth = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, error: "Invalid or expired token" });
  }
}

// ✅ EXPORTABLE ADMIN MIDDLEWARE
function requireAdmin(req, res, next) {
  if (!req.auth) return res.status(401).json({ success: false, error: "Unauthorized" });
  if (req.auth.role !== "admin") return res.status(403).json({ success: false, error: "Admin only" });

  if (String(req.auth.email || "").toLowerCase() !== STATIC_ADMIN_EMAIL_FINAL) {
    return res.status(403).json({ success: false, error: "Invalid admin identity" });
  }

  return next();
}

// -------------------- RATE LIMIT --------------------
const requestOtpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many login attempts. Try again in a minute." },
});

const verifyOtpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many verify attempts. Try again in a minute." },
});

// -------------------- TWILIO --------------------
let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}
async function sendSmsOtp(phone, otp) {
  if (!twilioClient) throw new Error("Twilio not configured");
  if (!TWILIO_FROM_NUMBER) throw new Error("TWILIO_FROM_NUMBER missing");
  await twilioClient.messages.create({
    from: TWILIO_FROM_NUMBER,
    to: phone,
    body: `Your OTP is ${otp}. Valid for 5 minutes.`,
  });
}

// -------------------- EMAIL (GMAIL SMTP) --------------------
function createMailer() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  const pass = String(GMAIL_APP_PASSWORD).replace(/\s/g, "");
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: GMAIL_USER, pass },
  });
}
const mailer = createMailer();

async function sendEmailOtp(email, otp) {
  if (!mailer) throw new Error("Email not configured (GMAIL_USER/GMAIL_APP_PASSWORD missing)");

  await mailer.sendMail({
    from: `OTP Login <${GMAIL_USER}>`,
    to: email,
    subject: "Your OTP Code",
    text: `Your OTP is ${otp}. It is valid for 5 minutes.`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.4">
        <h2>Your OTP Code</h2>
        <p>Use this code to login:</p>
        <div style="font-size:28px;font-weight:700;letter-spacing:2px;margin:12px 0">${otp}</div>
        <p>This OTP is valid for <b>5 minutes</b>.</p>
      </div>
    `,
  });
}

// -------------------- ROUTES --------------------

// ✅ STATIC ADMIN LOGIN (GET)
router.get("/admin/login", (req, res) => {
  const email = normalizeEmail(req.query.email);
  const password = String(req.query.password || "");

  if (email !== STATIC_ADMIN_EMAIL_FINAL || password !== STATIC_ADMIN_PASSWORD_FINAL) {
    return res.status(401).json({ success: false, error: "Invalid admin credentials" });
  }

  const token = signToken({
    userId: "admin_static",
    role: "admin",
    email: STATIC_ADMIN_EMAIL_FINAL,
  });

  return res.json({
    success: true,
    token,
    user: { id: "admin_static", role: "admin", email: STATIC_ADMIN_EMAIL_FINAL },
  });
});

// ✅ USER SIGNUP
router.post("/signup", async (req, res) => {
  try {
    const firstName = String(req.body.firstName || "").trim();
    const lastName = String(req.body.lastName || "").trim();
    const email = normalizeEmail(req.body.email);
    const phoneRaw = normalizePhone(req.body.phone);
    const phone = phoneRaw ? phoneRaw : undefined;
    const password = String(req.body.password || "");

    if (!firstName) return res.status(400).json({ success: false, error: "First name is required" });
    if (!lastName) return res.status(400).json({ success: false, error: "Last name is required" });
    if (!email) return res.status(400).json({ success: false, error: "Email is required" });
    if (!isEmail(email)) return res.status(400).json({ success: false, error: "Invalid email" });
    if (phone && !isE164(phone)) return res.status(400).json({ success: false, error: "Phone must be E.164 like +919876543210" });
    if (!passwordOk(password)) return res.status(400).json({ success: false, error: "Password must be at least 8 characters" });

    if (email === STATIC_ADMIN_EMAIL_FINAL) {
      return res.status(403).json({ success: false, error: "This email is reserved for admin." });
    }

    const exists = await User.findOne({ $or: [{ email }, ...(phone ? [{ phone }] : [])] });
    if (exists) return res.status(409).json({ success: false, error: "User already exists" });

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      firstName,
      lastName,
      email,
      ...(phone ? { phone } : {}),
      passwordHash,
      role: "user",
      isEmailVerified: false,
      isPhoneVerified: false,
    });

    return res.json({
      success: true,
      message: "User created successfully",
      user: { id: user._id, firstName, lastName, email: user.email, phone: user.phone || null, role: user.role },
    });
  } catch (e) {
    console.error("❌ signup error:", e?.message || e);
    return res.status(500).json({ success: false, error: "Signup failed" });
  }
});

// ✅ USER LOGIN WITH PASSWORD
router.post("/login/password", async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!email) return res.status(400).json({ success: false, error: "Email is required" });
    if (!isEmail(email)) return res.status(400).json({ success: false, error: "Invalid email" });
    if (!passwordOk(password)) {
      return res.status(400).json({ success: false, error: "Password must be at least 8 characters" });
    }

    // prevent admin login via user endpoint
    if (email === STATIC_ADMIN_EMAIL_FINAL) {
      return res.status(403).json({ success: false, error: "Use /api/auth/admin/login for admin." });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const storedHash = getStoredPasswordHash(user);
    if (!storedHash) return res.status(500).json({ success: false, error: "Password hash missing in DB." });

    const ok = await bcrypt.compare(password, storedHash);
    if (!ok) return res.status(401).json({ success: false, error: "Invalid password" });

    // ✅ Legacy support: if flags missing, treat as verified and set true once
    const emailFlagMissing = typeof user.isEmailVerified !== "boolean";
    const phoneFlagMissing = typeof user.isPhoneVerified !== "boolean";
    if (emailFlagMissing && phoneFlagMissing) {
      user.isEmailVerified = true;
      await user.save();
    }

    const verified = !!user.isEmailVerified || !!user.isPhoneVerified;
    if (!verified) {
      return res.json({
        success: true,
        otpRequired: true,
        message: "OTP verification required. Call /api/auth/login/request-otp",
      });
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = signToken({
      userId: user._id.toString(),
      role: user.role,
      email: user.email || null,
      phone: user.phone || null,
    });

    return res.json({
      success: true,
      otpRequired: false,
      token,
      user: { id: user._id, role: user.role, email: user.email, phone: user.phone || null },
    });
  } catch (e) {
    console.error("❌ login/password:", e?.message || e);
    return res.status(500).json({ success: false, error: "Login failed" });
  }
});

// ✅ LOGIN - REQUEST OTP
router.post("/login/request-otp", requestOtpLimiter, async (req, res) => {
  try {
    const channel = String(req.body.channel || "").trim();
    const identifierRaw = String(req.body.identifier || "").trim();
    const password = String(req.body.password || "");

    if (!["email", "sms"].includes(channel)) return res.status(400).json({ success: false, error: 'channel must be "email" or "sms"' });
    if (!identifierRaw) return res.status(400).json({ success: false, error: "identifier is required" });
    if (!passwordOk(password)) return res.status(400).json({ success: false, error: "Password must be at least 8 characters" });

    const identifier = channel === "email" ? normalizeEmail(identifierRaw) : normalizePhone(identifierRaw);
    if (channel === "email" && !isEmail(identifier)) return res.status(400).json({ success: false, error: "Invalid email" });
    if (channel === "sms" && !isE164(identifier)) return res.status(400).json({ success: false, error: "Phone must be E.164 like +919876543210" });

    if (identifier === STATIC_ADMIN_EMAIL_FINAL) {
      return res.status(403).json({ success: false, error: "Use /api/auth/admin/login for admin." });
    }

    const user = await User.findOne(channel === "email" ? { email: identifier } : { phone: identifier });
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const storedHash = getStoredPasswordHash(user);
    if (!storedHash) return res.status(500).json({ success: false, error: "Password hash missing in DB." });

    const ok = await bcrypt.compare(password, storedHash);
    if (!ok) return res.status(401).json({ success: false, error: "Invalid password" });

    const alreadyVerified = channel === "email" ? !!user.isEmailVerified : !!user.isPhoneVerified;
    if (alreadyVerified) {
      user.lastLoginAt = new Date();
      await user.save();
      const token = signToken({ userId: user._id.toString(), role: user.role, email: user.email || null, phone: user.phone || null });
      return res.json({ success: true, otpRequired: false, token, user: { id: user._id, role: user.role, email: user.email } });
    }

    await OtpSession.updateMany({ userId: user._id, channel, identifier, used: false }, { $set: { used: true } });

    const otp = generateOtp();
    const otpHash = hashOtp(identifier, otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await OtpSession.create({ channel, identifier, userId: user._id, otpHash, expiresAt, attempts: 0, maxAttempts: 5, used: false });

    if (channel === "sms") await sendSmsOtp(identifier, otp);
    else await sendEmailOtp(identifier, otp);

    return res.json({ success: true, otpRequired: true, message: "OTP sent", expiresInSeconds: 300 });
  } catch (e) {
    console.error("❌ login/request-otp:", e?.message || e);
    return res.status(500).json({ success: false, error: "Failed to login", detail: e?.message || "" });
  }
});

// ✅ LOGIN - VERIFY OTP
router.post("/login/verify-otp", verifyOtpLimiter, async (req, res) => {
  try {
    const channel = String(req.body.channel || "").trim();
    const identifierRaw = String(req.body.identifier || "").trim();
    const password = String(req.body.password || "");
    const otp = String(req.body.otp || "").trim();

    if (!["email", "sms"].includes(channel)) return res.status(400).json({ success: false, error: 'channel must be "email" or "sms"' });
    if (!identifierRaw) return res.status(400).json({ success: false, error: "identifier is required" });
    if (!otp) return res.status(400).json({ success: false, error: "otp is required" });
    if (!passwordOk(password)) return res.status(400).json({ success: false, error: "Password must be at least 8 characters" });

    const identifier = channel === "email" ? normalizeEmail(identifierRaw) : normalizePhone(identifierRaw);
    if (identifier === STATIC_ADMIN_EMAIL_FINAL) return res.status(403).json({ success: false, error: "Use /api/auth/admin/login for admin." });

    const user = await User.findOne(channel === "email" ? { email: identifier } : { phone: identifier });
    if (!user) return res.status(404).json({ success: false, error: "User not found" });

    const storedHash = getStoredPasswordHash(user);
    if (!storedHash) return res.status(500).json({ success: false, error: "Password hash missing in DB." });

    const ok = await bcrypt.compare(password, storedHash);
    if (!ok) return res.status(401).json({ success: false, error: "Invalid password" });

    const session = await OtpSession.findOne({ userId: user._id, channel, identifier, used: false }).sort({ createdAt: -1 });
    if (!session) return res.status(400).json({ success: false, error: "No OTP found. Request again." });

    if (session.expiresAt.getTime() < Date.now()) {
      session.used = true;
      await session.save();
      return res.status(400).json({ success: false, error: "OTP expired. Request again." });
    }

    if (session.attempts >= session.maxAttempts) {
      session.used = true;
      await session.save();
      return res.status(429).json({ success: false, error: "Too many attempts. Request new OTP." });
    }

    const incomingHash = hashOtp(identifier, otp);
    if (incomingHash !== session.otpHash) {
      session.attempts += 1;
      await session.save();
      return res.status(401).json({ success: false, error: "Invalid OTP" });
    }

    session.used = true;
    await session.save();

    if (channel === "email") user.isEmailVerified = true;
    if (channel === "sms") user.isPhoneVerified = true;

    user.lastLoginAt = new Date();
    await user.save();

    const token = signToken({ userId: user._id.toString(), role: user.role, email: user.email || null, phone: user.phone || null });
    return res.json({ success: true, token, user: { id: user._id, role: user.role, email: user.email } });
  } catch (e) {
    console.error("❌ login/verify-otp:", e?.message || e);
    return res.status(500).json({ success: false, error: "OTP verify failed", detail: e?.message || "" });
  }
});

// ✅ ME
router.get("/me", authMiddleware, async (req, res) => {
  try {
    if (req.auth.userId === "admin_static" && req.auth.role === "admin") {
      return res.json({
        success: true,
        user: { id: "admin_static", role: "admin", email: STATIC_ADMIN_EMAIL_FINAL, firstName: "Admin", lastName: "User" },
      });
    }

    const user = await User.findById(req.auth.userId).select(
      "firstName lastName email phone role isEmailVerified isPhoneVerified lastLoginAt createdAt updatedAt"
    );
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    return res.json({ success: true, user });
  } catch {
    return res.status(500).json({ success: false, error: "Failed to fetch user" });
  }
});

module.exports = {
  router,
  authMiddleware,
  requireAdmin,
};
