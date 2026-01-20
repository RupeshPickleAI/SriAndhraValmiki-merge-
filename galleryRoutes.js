// galleryRoutes.js
const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

/* ------------------ Helpers ------------------ */
function makeSafeFileName(originalName) {
  const ext = path.extname(originalName);
  const baseName = path
    .basename(originalName, ext)
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-]/g, "");
  return `${baseName}_${Date.now()}${ext}`;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

/* ------------------ Mongoose Models ------------------ */
const galleryFolderSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    thumbnailUrl: { type: String, default: "" },
  },
  { timestamps: true }
);

const galleryImageSchema = new mongoose.Schema(
  {
    folderId: { type: mongoose.Schema.Types.ObjectId, ref: "GalleryFolder", required: true },
    url: { type: String, required: true },
    caption: { type: String, default: "", trim: true },
    originalName: String,
    fileName: String,
    size: Number,
    mimeType: String,
  },
  { timestamps: true }
);

const GalleryFolder = mongoose.models.GalleryFolder || mongoose.model("GalleryFolder", galleryFolderSchema);
const GalleryImage = mongoose.models.GalleryImage || mongoose.model("GalleryImage", galleryImageSchema);

/* ------------------ Multer Storage ------------------ */
const galleryStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folderId = req.galleryFolderId || req.params.folderId || "misc";
    const dest = path.join(__dirname, "uploads", "gallery", String(folderId));
    ensureDir(dest);
    cb(null, dest);
  },
  filename: (_, file, cb) => cb(null, makeSafeFileName(file.originalname)),
});

function imageFileFilter(_, file, cb) {
  if (file.mimetype.startsWith("image/")) cb(null, true);
  else cb(new Error("Only image files are allowed!"), false);
}

const uploadSingleThumb = multer({
  storage: galleryStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
}).single("thumbnail");

const uploadMultipleImages = multer({
  storage: galleryStorage,
  fileFilter: imageFileFilter,
  limits: { fileSize: 20 * 1024 * 1024 },
}).array("images", 30);

/* ------------------ FOLDERS CRUD ------------------ */

router.post(
  "/folders",
  (req, _res, next) => {
    req.galleryFolderId = new mongoose.Types.ObjectId();
    next();
  },
  (req, res) => {
    uploadSingleThumb(req, res, async (err) => {
      try {
        if (err) return res.status(400).json({ success: false, error: err.message });

        const title = (req.body.title || "").trim();
        const description = (req.body.description || "").trim();

        if (!title) return res.status(400).json({ success: false, error: "title is required" });

        let thumbnailUrl = "";
        if (req.file) {
          thumbnailUrl = `${req.protocol}://${req.get("host")}/uploads/gallery/${req.galleryFolderId}/${req.file.filename}`;
        }

        const folder = await GalleryFolder.create({
          _id: req.galleryFolderId,
          title,
          description,
          thumbnailUrl,
        });

        return res.json({ success: true, message: "Folder created", data: folder });
      } catch (e) {
        console.error(e);
        return res.status(500).json({ success: false, error: "Failed to create folder" });
      }
    });
  }
);

router.get("/folders", async (_req, res) => {
  try {
    const folders = await GalleryFolder.find().sort({ createdAt: -1 }).lean();

    const counts = await GalleryImage.aggregate([
      { $group: { _id: "$folderId", count: { $sum: 1 } } },
    ]);

    const map = new Map(counts.map((c) => [String(c._id), c.count]));

    const out = folders.map((f) => ({
      ...f,
      imageCount: map.get(String(f._id)) || 0,
    }));

    return res.json({ success: true, data: out });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: "Failed to fetch folders" });
  }
});

router.get("/folders/:folderId", async (req, res) => {
  try {
    const folder = await GalleryFolder.findById(req.params.folderId);
    if (!folder) return res.status(404).json({ success: false, error: "Folder not found" });
    return res.json({ success: true, data: folder });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: "Failed to fetch folder" });
  }
});

router.put("/folders/:folderId", async (req, res) => {
  try {
    const { title, description } = req.body;

    const updated = await GalleryFolder.findByIdAndUpdate(
      req.params.folderId,
      {
        ...(title !== undefined ? { title: String(title).trim() } : {}),
        ...(description !== undefined ? { description: String(description).trim() } : {}),
      },
      { new: true }
    );

    if (!updated) return res.status(404).json({ success: false, error: "Folder not found" });

    return res.json({ success: true, message: "Folder updated", data: updated });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: "Failed to update folder" });
  }
});

router.post("/folders/:folderId/thumbnail", (req, res) => {
  uploadSingleThumb(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ success: false, error: err.message });
      if (!req.file) return res.status(400).json({ success: false, error: "No thumbnail uploaded" });

      const folderId = req.params.folderId;
      const url = `${req.protocol}://${req.get("host")}/uploads/gallery/${folderId}/${req.file.filename}`;

      const updated = await GalleryFolder.findByIdAndUpdate(folderId, { thumbnailUrl: url }, { new: true });
      if (!updated) return res.status(404).json({ success: false, error: "Folder not found" });

      return res.json({ success: true, message: "Thumbnail updated", data: updated });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ success: false, error: "Failed to update thumbnail" });
    }
  });
});

router.delete("/folders/:folderId", async (req, res) => {
  try {
    const folderId = req.params.folderId;

    const folder = await GalleryFolder.findById(folderId);
    if (!folder) return res.status(404).json({ success: false, error: "Folder not found" });

    await GalleryImage.deleteMany({ folderId });
    await GalleryFolder.deleteOne({ _id: folderId });

    const dir = path.join(__dirname, "uploads", "gallery", String(folderId));
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });

    return res.json({ success: true, message: "Folder deleted" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: "Failed to delete folder" });
  }
});

/* ------------------ IMAGES CRUD ------------------ */

router.post("/folders/:folderId/images", (req, res) => {
  uploadMultipleImages(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ success: false, error: err.message });

      const folderId = req.params.folderId;
      const folder = await GalleryFolder.findById(folderId);
      if (!folder) return res.status(404).json({ success: false, error: "Folder not found" });

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, error: "No images uploaded" });
      }

      const docs = await GalleryImage.insertMany(
        req.files.map((f) => ({
          folderId,
          url: `${req.protocol}://${req.get("host")}/uploads/gallery/${folderId}/${f.filename}`,
          caption: (req.body.caption || "").trim(),
          originalName: f.originalname,
          fileName: f.filename,
          size: f.size,
          mimeType: f.mimetype,
        }))
      );

      return res.json({ success: true, message: "Images added", data: docs });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ success: false, error: "Failed to add images" });
    }
  });
});

router.get("/folders/:folderId/images", async (req, res) => {
  try {
    const list = await GalleryImage.find({ folderId: req.params.folderId }).sort({ createdAt: -1 });
    return res.json({ success: true, data: list });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: "Failed to fetch images" });
  }
});

router.put("/images/:imageId", async (req, res) => {
  try {
    const caption = (req.body.caption || "").trim();
    const updated = await GalleryImage.findByIdAndUpdate(req.params.imageId, { caption }, { new: true });
    if (!updated) return res.status(404).json({ success: false, error: "Image not found" });

    return res.json({ success: true, message: "Image updated", data: updated });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: "Failed to update image" });
  }
});

router.delete("/images/:imageId", async (req, res) => {
  try {
    const img = await GalleryImage.findById(req.params.imageId);
    if (!img) return res.status(404).json({ success: false, error: "Image not found" });

    const folderId = String(img.folderId);
    const fileName = img.fileName;

    await GalleryImage.deleteOne({ _id: img._id });

    const filePath = path.join(__dirname, "uploads", "gallery", folderId, fileName);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    return res.json({ success: true, message: "Image deleted" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ success: false, error: "Failed to delete image" });
  }
});

module.exports = router;
