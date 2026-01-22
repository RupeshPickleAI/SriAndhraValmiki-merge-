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

// ✅ Prefer Render env MONGODB_URI_GLOBAL
const DB_URL =
  process.env.MONGODB_URI_GLOBAL ||
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

// ✅ Admin-only for ALL write methods
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
function adminForWrites(req, res, next) {
  if (READ_METHODS.has(req.method)) return next(); // public read

  // allow auth endpoints
  if (req.originalUrl.startsWith("/api/auth")) return next();

  // enforce admin for all writes
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

// ---- MONGOOSE SETUP ----
let DB_READY = false;

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

// Connect once (serverless safe)
let mongooseConnecting = null;
async function connectMongoOnce() {
  if (DB_READY) return;
  if (mongooseConnecting) return mongooseConnecting;

  mongooseConnecting = mongoose
    .connect(DB_URL, {
      serverSelectionTimeoutMS: 20000,
      connectTimeoutMS: 20000,
      socketTimeoutMS: 45000,
    })
    .then(() => {
      console.log("✅ Connected to MongoDB at", DB_URL);
      DB_READY = true;
    })
    .catch((err) => {
      console.error("❌ MongoDB connection error:", err.message);
      DB_READY = false;
      throw err;
    });

  return mongooseConnecting;
}

// Ensure DB for API endpoints that need it
async function requireDb(req, res, next) {
  try {
    await connectMongoOnce();
    return next();
  } catch {
    return res.status(503).json({
      success: false,
      error: "Database not connected. Check MongoDB URI / Atlas IP whitelist.",
    });
  }
}

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
const AUDIO_DB_PATH = path.join(__dirname, "..", "audio-db.json");

function readAudioDb() {
  try {
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
  destination: (_req, _file, cb) => {
    fs.mkdir(IMAGE_UPLOAD_PATH, { recursive: true }, (err) => cb(err, IMAGE_UPLOAD_PATH));
  },
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

// ---- HEALTH ----
app.get("/api/health", (_req, res) => {
  res.json({
    success: true,
    dbReady: DB_READY,
    mongooseState: mongoose.connection.readyState,
  });
});

// ---- BASIC ----
app.get("/", (_req, res) => res.redirect("/login"));

// ✅ AUTH first (needs DB because it queries users)
app.use("/api/auth", requireDb, auth.router);

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
function handleImageUpload(req, res) {
  uploadImage(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    if (!req.file) return res.status(400).json({ success: false, error: "No image file uploaded" });

    const fileUrl = `${req.protocol}://${req.get("host")}/uploads/images/${req.file.filename}`;

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

// ---------------- VIDEO FILE UPLOAD (ADMIN ONLY) ----------------
app.post("/api/upload/video", requireDb, adminForWrites, (req, res) => {
  uploadVideo(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    if (!req.file) return res.status(400).json({ success: false, error: "No video file uploaded" });

    const fileUrl = `${req.protocol}://${req.get("host")}/uploads/videos/${req.file.filename}`;

    try {
      const mediaDoc = await Media.create({
        type: "video",
        url: fileUrl,
        originalName: req.file.originalname,
        fileName: req.file.filename,
        size: req.file.size,
        mimeType: req.file.mimetype,
      });

      res.json({ success: true, message: "Video file uploaded & saved to DB", data: mediaDoc });
    } catch (e) {
      console.error("❌ Media.create(video) failed:", e?.message || e);
      res.status(500).json({ success: false, error: "Video uploaded but failed to save in DB" });
    }
  });
});

// ---------------- BANNER IMAGE UPLOAD (ADMIN ONLY) ----------------
app.post("/api/upload/banner", requireDb, adminForWrites, (req, res) => {
  uploadBanner(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    if (!req.file) return res.status(400).json({ success: false, error: "No banner file uploaded" });

    const fileUrl = `${req.protocol}://${req.get("host")}/uploads/banners/${req.file.filename}`;

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

// ---------------- AUDIO UPLOAD (ADMIN WRITE, PUBLIC READ) ----------------
app.post("/api/upload/audio", adminForWrites, (req, res) => {
  uploadAudio(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    if (!req.file) return res.status(400).json({ success: false, error: "No audio file uploaded" });

    const fileUrl = `${req.protocol}://${req.get("host")}/uploads/audio/${req.file.filename}`;

    const list = readAudioDb();
    const audioItem = {
      id: Date.now().toString(),
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

// ---------------- ROUTES (ADMIN WRITE / PUBLIC READ) ----------------
app.use("/api/videos", requireDb, adminForWrites, videosRoutes);
app.use("/api/gallery", requireDb, adminForWrites, galleryRoutes);
app.use("/api/notifications", requireDb, adminForWrites, notificationRoutes);
app.use("/api", requireDb, adminForWrites, contentRoutes);

// ---------------- FRONTEND (Vite dist) ----------------
const FRONTEND_DIST = path.join(__dirname, "..", "frontend", "dist");

if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
} else {
  console.warn("⚠️ Frontend dist not found at:", FRONTEND_DIST);

  // ✅ FIX: don't use app.get("*") -> causes path-to-regexp crash on Render/Node22
  app.use((req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) return next();
    return res.status(404).json({
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
