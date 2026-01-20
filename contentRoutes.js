const express = require("express");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

// -----------------------------
// Helpers
// -----------------------------
const UPLOADS_ROOT = path.join(__dirname, "uploads");
const PDF_DIR = path.join(UPLOADS_ROOT, "pdfs");

if (!fs.existsSync(PDF_DIR)) fs.mkdirSync(PDF_DIR, { recursive: true });

function makeSafeFileName(originalName) {
  const ext = path.extname(originalName || ".pdf") || ".pdf";
  const base = path
    .basename(originalName || "file", ext)
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_\-]/g, "");
  return `${base}_${Date.now()}${ext}`;
}

function normalizeArrayResponse(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.data)) return raw.data;
  if (raw && Array.isArray(raw.items)) return raw.items;
  return [];
}

async function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.warn("⚠️ Failed to delete file:", filePath, e.message);
  }
}

// -----------------------------
// Mongoose Models (content)
// -----------------------------
const ArticleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: String,
    label: String,
    order: Number,
  },
  { timestamps: true, strict: false } // ✅ allow title_te etc
);
const ChapterSchema = new mongoose.Schema(
  {
    articleId: { type: String, required: true },
    title: { type: String, required: true },
    summary: String,
    label: String,
    order: Number,
  },
  { timestamps: true, strict: false }
);
const TopicSchema = new mongoose.Schema(
  {
    chapterId: { type: String, required: true },
    title: { type: String, required: true },
    description: String,
    label: String,
    order: Number,
  },
  { timestamps: true, strict: false }
);
const ContentSchema = new mongoose.Schema(
  {
    topicId: { type: String, required: true },
    heading: String,
    body: { type: String, required: true },
    label: String,
    order: Number,
  },
  { timestamps: true, strict: false }
);

const PdfSchema = new mongoose.Schema(
  {
    parentType: {
      type: String,
      enum: ["article", "chapter", "topic", "content"],
      required: true,
    },
    parentId: { type: String, required: true },

    title: String,
    description: String,

    url: { type: String, required: true },
    fileName: { type: String, required: true },
    originalName: String,
    size: Number,
    mimeType: String,
  },
  { timestamps: true }
);

const Article = mongoose.models.Article || mongoose.model("Article", ArticleSchema);
const Chapter = mongoose.models.Chapter || mongoose.model("Chapter", ChapterSchema);
const Topic = mongoose.models.Topic || mongoose.model("Topic", TopicSchema);
const Content = mongoose.models.Content || mongoose.model("Content", ContentSchema);
const Pdf = mongoose.models.Pdf || mongoose.model("Pdf", PdfSchema);

// -----------------------------
// Content CRUD
// Mounted at /api in server.js, so paths below are /api/content/*
// -----------------------------

// ARTICLES
router.get("/content/articles", async (req, res) => {
  try {
    const items = await Article.find().sort({ order: 1, createdAt: -1 });
    res.json({ success: true, data: items });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post("/content/articles", async (req, res) => {
  try {
    const doc = await Article.create(req.body);
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.put("/content/articles/:id", async (req, res) => {
  try {
    const doc = await Article.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ success: false, error: "Article not found" });
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.delete("/content/articles/:id", async (req, res) => {
  try {
    const articleId = req.params.id;

    // cascade: chapters -> topics -> contents + PDFs
    const chapters = await Chapter.find({ articleId });
    const chapterIds = chapters.map((c) => String(c._id));

    const topics = await Topic.find({ chapterId: { $in: chapterIds } });
    const topicIds = topics.map((t) => String(t._id));

    const contents = await Content.find({ topicId: { $in: topicIds } });
    const contentIds = contents.map((c) => String(c._id));

    // delete PDFs attached to any of these
    const pdfs = await Pdf.find({
      $or: [
        { parentType: "article", parentId: articleId },
        { parentType: "chapter", parentId: { $in: chapterIds } },
        { parentType: "topic", parentId: { $in: topicIds } },
        { parentType: "content", parentId: { $in: contentIds } },
      ],
    });

    for (const p of pdfs) {
      const diskPath = path.join(PDF_DIR, p.fileName);
      await safeUnlink(diskPath);
    }
    await Pdf.deleteMany({ _id: { $in: pdfs.map((p) => p._id) } });

    await Content.deleteMany({ topicId: { $in: topicIds } });
    await Topic.deleteMany({ chapterId: { $in: chapterIds } });
    await Chapter.deleteMany({ articleId });
    await Article.findByIdAndDelete(articleId);

    res.json({ success: true, message: "Article deleted (cascade)" });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// CHAPTERS
router.get("/content/chapters", async (req, res) => {
  try {
    const { articleId } = req.query;
    const q = articleId ? { articleId } : {};
    const items = await Chapter.find(q).sort({ order: 1, createdAt: -1 });
    res.json({ success: true, data: items });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post("/content/chapters", async (req, res) => {
  try {
    const doc = await Chapter.create(req.body);
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.put("/content/chapters/:id", async (req, res) => {
  try {
    const doc = await Chapter.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ success: false, error: "Chapter not found" });
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.delete("/content/chapters/:id", async (req, res) => {
  try {
    const chapterId = req.params.id;

    const topics = await Topic.find({ chapterId });
    const topicIds = topics.map((t) => String(t._id));

    const contents = await Content.find({ topicId: { $in: topicIds } });
    const contentIds = contents.map((c) => String(c._id));

    const pdfs = await Pdf.find({
      $or: [
        { parentType: "chapter", parentId: chapterId },
        { parentType: "topic", parentId: { $in: topicIds } },
        { parentType: "content", parentId: { $in: contentIds } },
      ],
    });

    for (const p of pdfs) await safeUnlink(path.join(PDF_DIR, p.fileName));
    await Pdf.deleteMany({ _id: { $in: pdfs.map((p) => p._id) } });

    await Content.deleteMany({ topicId: { $in: topicIds } });
    await Topic.deleteMany({ chapterId });
    await Chapter.findByIdAndDelete(chapterId);

    res.json({ success: true, message: "Chapter deleted (cascade)" });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// TOPICS
router.get("/content/topics", async (req, res) => {
  try {
    const { chapterId } = req.query;
    const q = chapterId ? { chapterId } : {};
    const items = await Topic.find(q).sort({ order: 1, createdAt: -1 });
    res.json({ success: true, data: items });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post("/content/topics", async (req, res) => {
  try {
    const doc = await Topic.create(req.body);
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.put("/content/topics/:id", async (req, res) => {
  try {
    const doc = await Topic.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ success: false, error: "Topic not found" });
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.delete("/content/topics/:id", async (req, res) => {
  try {
    const topicId = req.params.id;

    const contents = await Content.find({ topicId });
    const contentIds = contents.map((c) => String(c._id));

    const pdfs = await Pdf.find({
      $or: [
        { parentType: "topic", parentId: topicId },
        { parentType: "content", parentId: { $in: contentIds } },
      ],
    });
    for (const p of pdfs) await safeUnlink(path.join(PDF_DIR, p.fileName));
    await Pdf.deleteMany({ _id: { $in: pdfs.map((p) => p._id) } });

    await Content.deleteMany({ topicId });
    await Topic.findByIdAndDelete(topicId);

    res.json({ success: true, message: "Topic deleted (cascade)" });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// CONTENTS
router.get("/content/contents", async (req, res) => {
  try {
    const { topicId } = req.query;
    const q = topicId ? { topicId } : {};
    const items = await Content.find(q).sort({ order: 1, createdAt: -1 });
    res.json({ success: true, data: items });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post("/content/contents", async (req, res) => {
  try {
    const doc = await Content.create(req.body);
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.put("/content/contents/:id", async (req, res) => {
  try {
    const doc = await Content.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!doc) return res.status(404).json({ success: false, error: "Content not found" });
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

router.delete("/content/contents/:id", async (req, res) => {
  try {
    const contentId = req.params.id;

    const pdfs = await Pdf.find({ parentType: "content", parentId: contentId });
    for (const p of pdfs) await safeUnlink(path.join(PDF_DIR, p.fileName));
    await Pdf.deleteMany({ parentType: "content", parentId: contentId });

    await Content.findByIdAndDelete(contentId);
    res.json({ success: true, message: "Content deleted" });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// -----------------------------
// PDF Upload CRUD (NEW)
// -----------------------------
const pdfStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, PDF_DIR),
  filename: (_, file, cb) => cb(null, makeSafeFileName(file.originalname)),
});

function pdfFilter(_, file, cb) {
  // allow application/pdf; if needed allow octet-stream too
  const ok = file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
  if (ok) cb(null, true);
  else cb(new Error("Only PDF files are allowed"), false);
}

const uploadPdf = multer({
  storage: pdfStorage,
  fileFilter: pdfFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
}).single("file");

// POST /api/content/pdfs (multipart: file + parentType + parentId)
router.post("/content/pdfs", (req, res) => {
  uploadPdf(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ success: false, error: err.message });
      if (!req.file) return res.status(400).json({ success: false, error: "No PDF uploaded" });

      const { parentType, parentId, title, description } = req.body;

      if (!parentType || !parentId) {
        await safeUnlink(path.join(PDF_DIR, req.file.filename));
        return res.status(400).json({
          success: false,
          error: "parentType and parentId are required",
        });
      }

      const url = `${req.protocol}://${req.get("host")}/uploads/pdfs/${req.file.filename}`;

      const doc = await Pdf.create({
        parentType,
        parentId,
        title: title || req.file.originalname,
        description: description || "",
        url,
        fileName: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
      });

      res.json({ success: true, data: doc });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
});

// GET /api/content/pdfs?parentType=...&parentId=...
router.get("/content/pdfs", async (req, res) => {
  try {
    const { parentType, parentId } = req.query;
    const q = {};
    if (parentType) q.parentType = parentType;
    if (parentId) q.parentId = parentId;

    const items = await Pdf.find(q).sort({ createdAt: -1 });
    res.json({ success: true, data: items });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/content/pdfs/:id
router.get("/content/pdfs/:id", async (req, res) => {
  try {
    const doc = await Pdf.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: "PDF not found" });
    res.json({ success: true, data: doc });
  } catch (e) {
    res.status(400).json({ success: false, error: e.message });
  }
});

// PUT /api/content/pdfs/:id (optional multipart file)
router.put("/content/pdfs/:id", (req, res) => {
  // allow replacing file or metadata
  const uploadOptional = multer({
    storage: pdfStorage,
    fileFilter: pdfFilter,
    limits: { fileSize: 50 * 1024 * 1024 },
  }).single("file");

  uploadOptional(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ success: false, error: err.message });

      const doc = await Pdf.findById(req.params.id);
      if (!doc) return res.status(404).json({ success: false, error: "PDF not found" });

      const { title, description, parentType, parentId } = req.body;

      if (title !== undefined) doc.title = title;
      if (description !== undefined) doc.description = description;
      if (parentType) doc.parentType = parentType;
      if (parentId) doc.parentId = parentId;

      if (req.file) {
        // delete old file
        await safeUnlink(path.join(PDF_DIR, doc.fileName));

        const url = `${req.protocol}://${req.get("host")}/uploads/pdfs/${req.file.filename}`;
        doc.url = url;
        doc.fileName = req.file.filename;
        doc.originalName = req.file.originalname;
        doc.size = req.file.size;
        doc.mimeType = req.file.mimetype;
      }

      await doc.save();
      res.json({ success: true, data: doc });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
});

// DELETE /api/content/pdfs/:id
router.delete("/content/pdfs/:id", async (req, res) => {
  try {
    const doc = await Pdf.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: "PDF not found" });

    await safeUnlink(path.join(PDF_DIR, doc.fileName));
    await Pdf.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: "PDF deleted" });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
