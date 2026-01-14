const express = require("express");
const mongoose = require("mongoose");

const router = express.Router();

// Video schema (YouTube/remote videos)
const videoSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    url: { type: String, required: true },
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

const Video = mongoose.models.Video || mongoose.model("Video", videoSchema);

// GET /api/videos - list all videos
router.get("/", async (req, res) => {
  try {
    const list = await Video.find().sort({ createdAt: -1 });
    res.json(list);
  } catch (e) {
    console.error("Error listing videos:", e);
    res.status(500).json({ success: false, error: "Failed to fetch videos" });
  }
});

// POST /api/videos - create video
router.post("/", async (req, res) => {
  try {
    const { title, url, description } = req.body;
    if (!title || !String(title).trim()) return res.status(400).json({ success: false, error: "title is required" });
    if (!url || !String(url).trim()) return res.status(400).json({ success: false, error: "url is required" });

    const doc = await Video.create({ title: String(title).trim(), url: String(url).trim(), description: String(description || "") });
    return res.json({ success: true, data: doc });
  } catch (e) {
    console.error("Create video error:", e);
    res.status(500).json({ success: false, error: "Failed to create video" });
  }
});

// GET /api/videos/:id
router.get("/:id", async (req, res) => {
  try {
    const doc = await Video.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: "Video not found" });
    res.json({ success: true, data: doc });
  } catch (e) {
    console.error("Get video error:", e);
    res.status(400).json({ success: false, error: "Invalid video id" });
  }
});

// PUT /api/videos/:id
router.put("/:id", async (req, res) => {
  try {
    const { title, url, description } = req.body;
    const update = {};
    if (title !== undefined) update.title = String(title).trim();
    if (url !== undefined) update.url = String(url).trim();
    if (description !== undefined) update.description = String(description);

    const doc = await Video.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!doc) return res.status(404).json({ success: false, error: "Video not found" });
    res.json({ success: true, data: doc });
  } catch (e) {
    console.error("Update video error:", e);
    res.status(400).json({ success: false, error: "Failed to update video" });
  }
});

// DELETE /api/videos/:id
router.delete("/:id", async (req, res) => {
  try {
    const doc = await Video.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: "Video not found" });
    res.json({ success: true, message: "Video deleted" });
  } catch (e) {
    console.error("Delete video error:", e);
    res.status(400).json({ success: false, error: "Failed to delete video" });
  }
});

module.exports = router;
