// server.js (MongoDB + media upload + content APIs + audio local JSON + gallery + notifications + auth + serve Vite dist)
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const mongoose = require("mongoose");

// separate files (your existing route modules)
const contentRoutes = require("./contentRoutes");
const galleryRoutes = require("./galleryRoutes");
const notificationRoutes = require("./notificationRoutes");
const videosRoutes = require("./videosRoutes");
const auth = require("./authentication");

const app = express();

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
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/media_upload_db";

// ---- MIDDLEWARE ----
app.use(cors());
app.use(express.json({ limit: "20mb" }));

// ✅ Serve all uploads (images/videos/banners/audio/pdfs/gallery)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ---- FOLDERS ----
const IMAGE_UPLOAD_PATH = path.join(__dirname, "uploads", "images");
const VIDEO_UPLOAD_PATH = path.join(__dirname, "uploads", "videos");
const BANNER_UPLOAD_PATH = path.join(__dirname, "uploads", "banners");
const AUDIO_UPLOAD_PATH = path.join(__dirname, "uploads", "audio");
const PDF_UPLOAD_PATH = path.join(__dirname, "uploads", "pdfs");
const GALLERY_UPLOAD_PATH = path.join(__dirname, "uploads", "gallery");

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
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("✅ Connected to MongoDB at", MONGODB_URI))
  .catch((err) => console.error("❌ MongoDB connection error:", err.message));

// ---- MONGOOSE MODELS ----

// Media model (images / videos / banners) (audio is local JSON)
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
const Media = mongoose.model("Media", mediaSchema);

// YouTube videos model (Mongo)
const videoSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    youtubeUrl: { type: String, required: true },
  },
  { timestamps: true }
);
const Video = mongoose.model("Video", videoSchema);

// ---- AUDIO "LOCAL STORAGE" (JSON FILE) ----
const AUDIO_DB_PATH = path.join(__dirname, "audio-db.json");

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
  destination: (req, file, cb) => {
    fs.mkdir(IMAGE_UPLOAD_PATH, { recursive: true }, (err) => cb(err, IMAGE_UPLOAD_PATH));
  },
  filename: (_, file, cb) => cb(null, makeSafeFileName(file.originalname)),
});

const videoStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, VIDEO_UPLOAD_PATH),
  filename: (_, file, cb) => cb(null, makeSafeFileName(file.originalname)),
});

const bannerStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, BANNER_UPLOAD_PATH),
  filename: (_, file, cb) => cb(null, makeSafeFileName(file.originalname)),
});

const audioStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, AUDIO_UPLOAD_PATH),
  filename: (_, file, cb) => cb(null, makeSafeFileName(file.originalname)),
});

function imageFileFilter(_, file, cb) {
  if (file.mimetype.startsWith("image/")) cb(null, true);
  else cb(new Error("Only image files are allowed!"), false);
}
function videoFileFilter(_, file, cb) {
  if (file.mimetype.startsWith("video/")) cb(null, true);
  else cb(new Error("Only video files are allowed!"), false);
}
function audioFileFilter(_, file, cb) {
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

// ---- BASIC HEALTH ----
app.get("/", (_req, res) => {
  return res.redirect("/login");
});


// ---------------- HOME SETTINGS APIs ----------------
app.get("/api/settings/home", (_req, res) => {
  const s = readHomeSettings();
  res.json({ success: true, data: s });
});

app.put("/api/settings/home", (req, res) => {
  const current = readHomeSettings();
  const next = { ...current, ...req.body, updatedAt: new Date().toISOString() };
  writeHomeSettings(next);
  res.json({ success: true, data: next });
});

// ---------------- IMAGE UPLOAD ----------------
async function handleImageUpload(req, res) {
  uploadImage(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message });
    if (!req.file)
      return res.status(400).json({ success: false, error: "No image file uploaded" });

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
    } catch {
      res.status(500).json({ success: false, error: "Image uploaded but failed to save in DB" });
    }
  });
}

app.post("/api/upload/image", handleImageUpload);
app.post("/upload/image", handleImageUpload); // legacy alias

// ---------------- VIDEO FILE UPLOAD ----------------
app.post("/api/upload/video", (req, res) => {
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
    } catch {
      res.status(500).json({ success: false, error: "Video uploaded but failed to save in DB" });
    }
  });
});

// ---------------- BANNER IMAGE UPLOAD ----------------
app.post("/api/upload/banner", (req, res) => {
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
    } catch {
      res.status(500).json({ success: false, error: "Banner uploaded but failed to save in DB" });
    }
  });
});

// ---------------- AUDIO UPLOAD + CRUD (LOCAL JSON) ----------------
app.post("/api/upload/audio", (req, res) => {
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

// ---------------- MOUNT YOUR OTHER ROUTES ----------------
app.use("/api", contentRoutes);
app.use("/api/gallery", galleryRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/videos", videosRoutes);
app.use("/api/auth", auth.router);      

// return a default audio (first item) for frontend convenience
app.get("/api/audio/default", (_req, res) => {
  try {
    const list = readAudioDb();
    if (!Array.isArray(list) || list.length === 0) return res.status(404).json({ success: false, error: "No audio available" });
    return res.json({ success: true, data: list[0] });
  } catch (e) {
    console.error("Error fetching default audio:", e);
    return res.status(500).json({ success: false, error: "Failed to fetch default audio" });
  }
});

// ---------------- FRONTEND (Vite dist) ----------------
const FRONTEND_DIST = path.join(__dirname, "frontend", "dist");

if (fs.existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));

  // ✅ SPA fallback only for NON api/uploads routes (Node 22 safe)
  app.get(/^(?!\/api|\/uploads).*/, (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
} else {
  console.warn("⚠️ Frontend dist not found at:", FRONTEND_DIST);

  // If dist not found, do NOT try to send index.html
  app.get("*", (req, res) => {
    res.status(404).json({ success: false, error: "Frontend build not found. Run frontend build." });
  });
}

// ---------------- ERROR HANDLER ----------------
app.use((err, _req, res, _next) => {
  console.error("❌ Server error:", err);
  res.status(500).json({ success: false, error: err.message || "Server error" });
});

// ---- START SERVER ----
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
