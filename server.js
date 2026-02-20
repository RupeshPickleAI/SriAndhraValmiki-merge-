// server.js
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");
const crypto = require("crypto");

// route modules
const contentRoutes = require("./contentRoutes");
const galleryRoutes = require("./galleryRoutes");
const notificationRoutes = require("./notificationRoutes");
const videosRoutes = require("./videosRoutes");
const auth = require("./authentication");

const app = express();

// ✅ IMPORTANT on Render (behind proxy) so req.protocol becomes https
app.set("trust proxy", 1);

// ---------------- SETTINGS STORE (home poster + marquee) ----------------
const SETTINGS_FILE = path.join(__dirname, "data", "homeSettings.json");
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

// ✅ MUST be set in Render Environment
const dbUrl =
  process.env.MONGODB_URI ||
  process.env.MONGO_URL ||
  "";

// Get the actual root directory (handle both root and nested execution)
const ROOT_DIR = __dirname.endsWith("media-upload-api")
  ? path.dirname(__dirname)
  : __dirname;

// ✅ Candidate dist folders (handles small repo-structure differences)
const FRONTEND_DIST_CANDIDATES = [
  path.join(ROOT_DIR, "frontend", "dist"),
  path.join(__dirname, "frontend", "dist"),
];

const UPLOADS_ROOT = path.join(ROOT_DIR, "uploads");

// ---- MIDDLEWARE ----
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(express.json({ limit: "20mb" }));

// 📋 REQUEST LOGGER (SAFE - masks secrets)
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();

  const safeBody = req.body && typeof req.body === "object" ? { ...req.body } : req.body;
  if (safeBody && typeof safeBody === "object") {
    if (safeBody.password) safeBody.password = "***";
    if (safeBody.otp) safeBody.otp = "***";
  }

  console.log(`\n📥 [${timestamp}] ${req.method} ${req.path}`);
  console.log(`   Body:`, safeBody);
  console.log(`   Headers:`, { authorization: req.headers.authorization ? "***" : "none" });

  const originalJson = res.json;
  res.json = function (data) {
    console.log(`   ✅ Response (${res.statusCode}):`, data);
    return originalJson.call(this, data);
  };

  next();
});

// ✅ Serve uploads
app.use("/uploads", express.static(UPLOADS_ROOT));

// ---- FOLDERS ----
const IMAGE_UPLOAD_PATH = path.join(UPLOADS_ROOT, "images");
const VIDEO_UPLOAD_PATH = path.join(UPLOADS_ROOT, "videos");
const BANNER_UPLOAD_PATH = path.join(UPLOADS_ROOT, "banners");
const AUDIO_UPLOAD_PATH = path.join(UPLOADS_ROOT, "audio");
const PDF_UPLOAD_PATH = path.join(UPLOADS_ROOT, "pdfs");
const GALLERY_UPLOAD_PATH = path.join(UPLOADS_ROOT, "gallery");

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

// ---- DB READY FLAG ----
let DB_READY = false;

function requireDb(req, res, next) {
  if (DB_READY) return next();
  return res.status(503).json({
    success: false,
    error: "Database not connected. Check MongoDB Atlas URI / IP whitelist.",
  });
}

mongoose.set("strictQuery", true);

mongoose.connection.on("connected", () => {
  DB_READY = true;
  console.log("✅ MongoDB connected");
});
mongoose.connection.on("disconnected", () => {
  DB_READY = false;
  console.log("⚠️ MongoDB disconnected");
});
mongoose.connection.on("error", (err) => {
  DB_READY = false;
  console.error("❌ MongoDB error:", err.message);
});

// ---- MONGOOSE MODELS ----
const mediaSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["image", "video", "banner"], required: true },
    url: { type: String, required: true },
    originalName: String,
    fileName: String,
    size: Number,
    mimeType: String,
  },
  { timestamps: true }
);
const Media = mongoose.models.Media || mongoose.model("Media", mediaSchema);

// ---- AUDIO LOCAL JSON ----
const AUDIO_DB_PATH = path.join(__dirname, "audio-db.json");

function ensureAudioDbFile() {
  try {
    if (!fs.existsSync(AUDIO_DB_PATH)) {
      fs.writeFileSync(AUDIO_DB_PATH, JSON.stringify([], null, 2), "utf8");
    }
  } catch (e) {
    console.error("❌ Failed to ensure audio-db.json:", e);
  }
}

function readAudioDb() {
  try {
    ensureAudioDbFile();
    const raw = fs.readFileSync(AUDIO_DB_PATH, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeAudioDb(list) {
  try {
    fs.writeFileSync(AUDIO_DB_PATH, JSON.stringify(list, null, 2), "utf8");
  } catch (err) {
    console.error("❌ Error writing audio-db.json:", err);
  }
}

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
const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, VIDEO_UPLOAD_PATH),
  filename: (_req, file, cb) => cb(null, makeSafeFileName(file.originalname)),
});
const bannerStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BANNER_UPLOAD_PATH),
  filename: (_req, file, cb) => cb(null, makeSafeFileName(file.originalname)),
});
const audioStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AUDIO_UPLOAD_PATH),
  filename: (_req, file, cb) => cb(null, makeSafeFileName(file.originalname)),
});

function imageFileFilter(_req, file, cb) {
  if (file.mimetype.startsWith("image/")) cb(null, true);
  else cb(new Error("Only image files are allowed!"), false);
}
function videoFileFilter(_req, file, cb) {
  if (file.mimetype.startsWith("video/")) cb(null, true);
  else cb(new Error("Only video files are allowed!"), false);
}
function audioFileFilter(_req, file, cb) {
  if (file.mimetype.startsWith("audio/")) cb(null, true);
  else cb(new Error("Only audio files are allowed!"), false);
}

const uploadImage = multer({
  storage: imageStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
}).single("image");

const uploadVideo = multer({
  storage: videoStorage,
  fileFilter: videoFileFilter,
  limits: { fileSize: 200 * 1024 * 1024 },
}).single("video");

const uploadBanner = multer({
  storage: bannerStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
}).single("banner");

const uploadAudio = multer({
  storage: audioStorage,
  fileFilter: audioFileFilter,
  limits: { fileSize: 100 * 1024 * 1024 },
}).single("audio");

// ---- BASIC ----
app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    dbReady: DB_READY,
    mongooseState: mongoose.connection.readyState,
  });
});

// ✅ Admin-only for ALL write methods
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
function adminForWrites(req, res, next) {
  if (READ_METHODS.has(req.method)) return next();
  if (req.originalUrl.startsWith("/api/auth")) return next();
  return auth.authMiddleware(req, res, () => auth.requireAdmin(req, res, next));
}

// ✅ AUTH first (needs DB)
app.use("/api/auth", requireDb, auth.router);

// ---------------- HOME SETTINGS APIs ----------------
app.get("/api/settings/home", (_req, res) => {
  const s = readHomeSettings();
  res.json({ success: true, data: s });
});

app.put("/api/settings/home", requireDb, adminForWrites, (req, res) => {
  const current = readHomeSettings();
  const next = { ...current, ...req.body, updatedAt: new Date().toISOString() };
  writeHomeSettings(next);
  res.json({ success: true, data: next });
});

// ---------------- UPLOAD HELPERS ----------------
function buildFileUrl(req, relativePath) {
  return `${req.protocol}://${req.get("host")}${relativePath}`;
}

// ---------------- IMAGE UPLOAD ----------------
function handleImageUpload(req, res) {
  if (!DB_READY) return res.status(503).json({ success: false, error: "Database not connected." });

  uploadImage(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    if (!req.file) return res.status(400).json({ success: false, error: "No image file uploaded" });

    const fileUrl = buildFileUrl(req, `/uploads/images/${req.file.filename}`);

    try {
      const mediaDoc = await Media.create({
        type: "image",
        url: fileUrl,
        originalName: req.file.originalname,
        fileName: req.file.filename,
        size: req.file.size,
        mimeType: req.file.mimetype,
      });
      res.json({ success: true, message: "Image uploaded & saved to DB", data: mediaDoc });
    } catch (e) {
      console.error("❌ Media.create(image) failed:", e?.message || e);
      res.status(500).json({ success: false, error: "Image uploaded but failed to save in DB" });
    }
  });
}

app.post("/api/upload/image", requireDb, adminForWrites, handleImageUpload);
app.post("/upload/image", requireDb, adminForWrites, handleImageUpload);

// ---------------- VIDEO UPLOAD ----------------
app.post("/api/upload/video", requireDb, adminForWrites, (req, res) => {
  if (!DB_READY) return res.status(503).json({ success: false, error: "Database not connected." });

  uploadVideo(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    if (!req.file) return res.status(400).json({ success: false, error: "No video file uploaded" });

    const fileUrl = buildFileUrl(req, `/uploads/videos/${req.file.filename}`);

    try {
      const mediaDoc = await Media.create({
        type: "video",
        url: fileUrl,
        originalName: req.file.originalname,
        fileName: req.file.filename,
        size: req.file.size,
        mimeType: req.file.mimetype,
      });
      res.json({ success: true, message: "Video uploaded & saved to DB", data: mediaDoc });
    } catch (e) {
      console.error("❌ Media.create(video) failed:", e?.message || e);
      res.status(500).json({ success: false, error: "Video uploaded but failed to save in DB" });
    }
  });
});

// ---------------- BANNER UPLOAD ----------------
app.post("/api/upload/banner", requireDb, adminForWrites, (req, res) => {
  if (!DB_READY) return res.status(503).json({ success: false, error: "Database not connected." });

  uploadBanner(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    if (!req.file) return res.status(400).json({ success: false, error: "No banner file uploaded" });

    const fileUrl = buildFileUrl(req, `/uploads/banners/${req.file.filename}`);

    try {
      const mediaDoc = await Media.create({
        type: "banner",
        url: fileUrl,
        originalName: req.file.originalname,
        fileName: req.file.filename,
        size: req.file.size,
        mimeType: req.file.mimetype,
      });

      const current = readHomeSettings();
      const next = { ...current, posterUrl: fileUrl, updatedAt: new Date().toISOString() };
      writeHomeSettings(next);

      res.json({
        success: true,
        message: "Banner uploaded & set as Home Poster ✅",
        data: mediaDoc,
        posterUrl: fileUrl,
      });
    } catch (e) {
      console.error("❌ Media.create(banner) failed:", e?.message || e);
      res.status(500).json({ success: false, error: "Banner uploaded but failed to save in DB" });
    }
  });
});

// ---------------- AUDIO UPLOAD ----------------
app.post("/api/upload/audio", requireDb, adminForWrites, (req, res) => {
  uploadAudio(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    if (!req.file) return res.status(400).json({ success: false, error: "No audio file uploaded" });

    const fileUrl = buildFileUrl(req, `/uploads/audio/${req.file.filename}`);

    const list = readAudioDb();

    const id =
      (crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

    const audioItem = {
      id: String(id),
      originalName: req.file.originalname,
      fileName: req.file.filename,
      url: fileUrl,
      uploadedAt: new Date().toISOString(),
    };

    list.push(audioItem);
    writeAudioDb(list);

    res.json({ success: true, message: "Audio uploaded & saved locally", data: audioItem });
  });
});

app.get("/api/audio", (_req, res) => {
  try {
    const list = readAudioDb().sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
    res.json({ success: true, data: list });
  } catch {
    res.status(500).json({ success: false, error: "Failed to fetch audio list" });
  }
});

app.get("/api/audio/default", (_req, res) => {
  try {
    const list = readAudioDb();
    if (!Array.isArray(list) || list.length === 0) {
      return res.status(404).json({ success: false, error: "No audio available" });
    }
    return res.json({ success: true, data: list[0] });
  } catch (e) {
    console.error("Error fetching default audio:", e);
    return res.status(500).json({ success: false, error: "Failed to fetch default audio" });
  }
});

// ✅ NEW: AUDIO DELETE (this fixes your 404)
app.delete("/api/audio/:id", requireDb, adminForWrites, (req, res) => {
  try {
    const { id } = req.params;

    const list = readAudioDb();
    const idx = list.findIndex((x) => String(x.id) === String(id));

    if (idx === -1) {
      return res.status(404).json({ success: false, error: "Audio not found" });
    }

    const removed = list[idx];
    list.splice(idx, 1);
    writeAudioDb(list);

    // Delete file from disk (best-effort)
    const fileName =
      removed.fileName ||
      (removed.url ? path.basename(String(removed.url)) : null);

    if (fileName) {
      const fullPath = path.join(AUDIO_UPLOAD_PATH, fileName);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      } else {
        console.warn("⚠️ Audio file not found on disk:", fullPath);
      }
    }

    return res.json({ success: true, message: "Audio deleted", data: removed });
  } catch (e) {
    console.error("❌ Error deleting audio:", e);
    return res.status(500).json({ success: false, error: "Failed to delete audio" });
  }
});

// ---------------- ROUTES ----------------
app.use("/api/videos", requireDb, adminForWrites, videosRoutes);
app.use("/api/gallery", requireDb, adminForWrites, galleryRoutes);
app.use("/api/notifications", requireDb, adminForWrites, notificationRoutes);
app.use("/api", requireDb, adminForWrites, contentRoutes);

// ---------------- FRONTEND (Vite dist) ----------------
function findFrontendDist() {
  for (const p of FRONTEND_DIST_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const FRONTEND_DIST = findFrontendDist();

if (FRONTEND_DIST) {
  console.log("✅ Frontend dist found at:", FRONTEND_DIST);
  app.use(express.static(FRONTEND_DIST));

  // SPA fallback (safe regex)
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
} else {
  console.warn("⚠️ Frontend dist not found. Backend will run without UI.");
  console.warn("   Build it on Render using: cd frontend && npm install && npm run build");

  // ✅ IMPORTANT FIX: DO NOT use app.get("*") (crashes with path-to-regexp)
  app.use((req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) return next();
    return res.status(404).json({
      success: false,
      error: "Frontend build not found. Run: cd frontend && npm run build",
    });
  });
}

// ---------------- ERROR HANDLER ----------------
app.use((err, req, res, _next) => {
  console.error("\n❌ ERROR Handler triggered");
  console.error(`   Route: ${req.method} ${req.path}`);
  console.error(`   Message: ${err.message}`);
  console.error(`   Stack:`, err.stack);
  res.status(500).json({ success: false, error: err.message || "Server error" });
});

// ---- START SERVER ----
async function start() {
  if (!dbUrl) {
    console.error("❌ MongoDB URI missing. Set MONGODB_URI in Render Environment.");
    process.exit(1);
  }

  console.log("🔌 Connecting to MongoDB...");
  await mongoose.connect(dbUrl, {
    serverSelectionTimeoutMS: 20000,
    connectTimeoutMS: 20000,
    socketTimeoutMS: 45000,
  });

  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("❌ Failed to start server:", err.message);
  process.exit(1);
});