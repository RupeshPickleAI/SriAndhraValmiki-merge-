// api/index.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");

// route modules
const contentRoutes = require("../contentRoutes");
const galleryRoutes = require("../galleryRoutes");
const notificationRoutes = require("../notificationRoutes");
const videosRoutes = require("../videosRoutes");
const auth = require("../authentication");

const app = express();

// ✅ IMPORTANT on Render (behind proxy) so req.protocol becomes https
app.set("trust proxy", 1);

// ---------------- SETTINGS STORE (home poster + marquee) ----------------
const SETTINGS_FILE = path.join(__dirname, "..", "data", "homeSettings.json");
const SETTINGS_DIR = path.dirname(SETTINGS_FILE);

function readHomeSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeHomeSettings(next) {
  if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf-8");
}

// ---- CONFIG ----
const PORT = process.env.PORT || 5000;

// ✅ FIX: use a real env variable (MONGODB_URI was undefined in your file)
const DB_URI =
  process.env.MONGODB_URI ||
  process.env.MONGODB_URI ||
  process.env.MONGO_URL ||
  "mongodb://127.0.0.1:27017/media_upload_db";

// ---- MIDDLEWARE ----
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "20mb" }));

// ✅ Serve all uploads
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

// ---- MONGOOSE SETUP ----
if (mongoose.connection.readyState === 0) {
  mongoose
    .connect(DB_URI, {
      serverSelectionTimeoutMS: 20000,
      connectTimeoutMS: 20000,
      socketTimeoutMS: 45000,
    })
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch((err) => console.error("❌ MongoDB connection error:", err.message));
}

// ✅ Admin-only for ALL write methods
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
function adminForWrites(req, res, next) {
  if (READ_METHODS.has(req.method)) return next(); // public read
  if (req.originalUrl.startsWith("/api/auth")) return next(); // allow auth endpoints
  return auth.authMiddleware(req, res, () => auth.requireAdmin(req, res, next));
}

// ---- FOLDERS ----
const IMAGE_UPLOAD_PATH = path.join(__dirname, "..", "uploads", "images");
const VIDEO_UPLOAD_PATH = path.join(__dirname, "..", "uploads", "videos");
const BANNER_UPLOAD_PATH = path.join(__dirname, "..", "uploads", "banners");
const AUDIO_UPLOAD_PATH = path.join(__dirname, "..", "uploads", "audio");
const PDF_UPLOAD_PATH = path.join(__dirname, "..", "uploads", "pdfs");
const GALLERY_UPLOAD_PATH = path.join(__dirname, "..", "uploads", "gallery");

[
  IMAGE_UPLOAD_PATH,
  VIDEO_UPLOAD_PATH,
  BANNER_UPLOAD_PATH,
  AUDIO_UPLOAD_PATH,
  PDF_UPLOAD_PATH,
  GALLERY_UPLOAD_PATH,
].forEach((folder) => {
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
});

// ---- MULTER CONFIG ----
function makeSafeFileName(originalName) {
  const ext = path.extname(originalName);
  const baseName = path
    .basename(originalName, ext)
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-]/g, "");
  return `${baseName}_${Date.now()}${ext}`;
}

const imageStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, IMAGE_UPLOAD_PATH),
  filename: (_req, file, cb) => cb(null, makeSafeFileName(file.originalname)),
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
}).single("image");

// ---- BASIC HEALTH ----
app.get("/", (_req, res) => res.redirect("/login"));

// ✅ AUTH first
app.use("/api/auth", auth.router);

// ---------------- HOME SETTINGS APIs ----------------
app.get("/api/settings/home", (_req, res) => {
  const s = readHomeSettings();
  res.json({ success: true, data: s });
});

app.put("/api/settings/home", adminForWrites, (req, res) => {
  const current = readHomeSettings();
  const next = { ...current, ...req.body, updatedAt: new Date().toISOString() };
  writeHomeSettings(next);
  res.json({ success: true, data: next });
});

// ---------------- IMAGE UPLOAD (ADMIN ONLY) ----------------
app.post("/api/upload/image", adminForWrites, (req, res) => {
  uploadImage(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    if (!req.file) return res.status(400).json({ success: false, error: "No image file uploaded" });
    return res.json({ success: true, message: "Image uploaded", file: req.file.filename });
  });
});

// ---------------- ROUTES (ADMIN WRITE / PUBLIC READ) ----------------
app.use("/api/videos", adminForWrites, videosRoutes);
app.use("/api/gallery", adminForWrites, galleryRoutes);
app.use("/api/notifications", adminForWrites, notificationRoutes);
app.use("/api", adminForWrites, contentRoutes);

// ---------------- FRONTEND (Vite dist) ----------------
const FRONTEND_DIST = path.join(__dirname, "..", "frontend", "dist");

if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
} else {
  console.warn("⚠️ Frontend dist not found at:", FRONTEND_DIST);

  // ✅ FIX: DO NOT use "*" (breaks with newer path-to-regexp)
  app.get(/.*/, (_req, res) => {
    res.status(404).json({
      success: false,
      error: "Frontend build not found. Run: cd frontend && npm run build",
    });
  });
}

// ---------------- ERROR HANDLER ----------------
app.use((err, _req, res, _next) => {
  console.error("❌ Server error:", err);
  res.status(500).json({ success: false, error: err.message || "Server error" });
});

module.exports = app;
