// videosRoutes.js
const express = require("express");
const mongoose = require("mongoose");
const auth = require("./authentication");

const router = express.Router();

// -------------------- ADMIN-ONLY FOR WRITES (PUBLIC READ) --------------------
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

router.use((req, res, next) => {
  if (READ_METHODS.has(req.method)) return next();

  // require admin for POST/PUT/DELETE
  return auth.authMiddleware(req, res, () => auth.requireAdmin(req, res, next));
});

// -------------------- YOUTUBE NORMALIZER --------------------
function extractYouTubeId(input) {
  try {
    const u = new URL(String(input).trim());

    // youtu.be/<id>
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace("/", "").trim();
      return id || null;
    }

    // youtube.com/...
    if (u.hostname.includes("youtube.com")) {
      // /watch?v=<id>
      if (u.pathname === "/watch") return u.searchParams.get("v") || null;

      // /embed/<id>
      if (u.pathname.startsWith("/embed/")) {
        const parts = u.pathname.split("/");
        return parts[2] || null;
      }

      // /shorts/<id>
      if (u.pathname.startsWith("/shorts/")) {
        const parts = u.pathname.split("/");
        return parts[2] || null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function normalizeVideoUrl(inputUrl) {
  const raw = String(inputUrl || "").trim();
  if (!raw) return { url: "", embedUrl: "", provider: "unknown", videoId: null };

  const ytId = extractYouTubeId(raw);
  if (ytId) {
    return {
      url: raw,
      embedUrl: `https://www.youtube-nocookie.com/embed/${ytId}`,
      provider: "youtube",
      videoId: ytId,
    };
  }

  return { url: raw, embedUrl: raw, provider: "external", videoId: null };
}

// -------------------- MONGOOSE MODEL --------------------
const videoSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    url: { type: String, required: true }, // original user input
    embedUrl: { type: String, required: true }, // normalized for iframe
    provider: { type: String, default: "youtube" },
    videoId: { type: String, default: null },
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

const Video = mongoose.models.Video || mongoose.model("Video", videoSchema);

// -------------------- ROUTES --------------------

// ✅ GET /api/videos (PUBLIC)
router.get("/", async (_req, res) => {
  try {
    const list = await Video.find().sort({ createdAt: -1 });

    const data = list.map((doc) => {
      const obj = doc.toObject();
      if (!obj.embedUrl) {
        const n = normalizeVideoUrl(obj.url);
        obj.embedUrl = n.embedUrl;
        obj.provider = obj.provider || n.provider;
        obj.videoId = obj.videoId || n.videoId;
      }
      return obj;
    });

    return res.json({ success: true, data });
  } catch (e) {
    console.error("Error listing videos:", e);
    return res.status(500).json({ success: false, error: "Failed to fetch videos" });
  }
});

// ✅ POST /api/videos (ADMIN)
// IMPORTANT: accepts BOTH { url } and { youtubeUrl } (backward compatibility)
router.post("/", async (req, res) => {
  try {
    const { title, url, youtubeUrl, description } = req.body;

    const finalTitle = String(title || "").trim();
    const finalUrl = String(url || youtubeUrl || "").trim();

    if (!finalTitle) {
      return res.status(400).json({ success: false, error: "title is required" });
    }

    if (!finalUrl) {
      return res.status(400).json({ success: false, error: "url is required" });
    }

    const n = normalizeVideoUrl(finalUrl);

    // enforce youtube only (as you want)
    if (n.provider !== "youtube") {
      return res.status(400).json({
        success: false,
        error: "Only YouTube URLs are supported. Please paste a valid YouTube link.",
      });
    }

    const doc = await Video.create({
      title: finalTitle,
      url: n.url,
      embedUrl: n.embedUrl,
      provider: n.provider,
      videoId: n.videoId,
      description: String(description || ""),
    });

    return res.json({ success: true, data: doc });
  } catch (e) {
    console.error("Create video error:", e);
    return res.status(500).json({ success: false, error: "Failed to create video" });
  }
});

// ✅ GET /api/videos/:id (PUBLIC)
router.get("/:id", async (req, res) => {
  try {
    const doc = await Video.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: "Video not found" });

    const obj = doc.toObject();
    if (!obj.embedUrl) {
      const n = normalizeVideoUrl(obj.url);
      obj.embedUrl = n.embedUrl;
      obj.provider = obj.provider || n.provider;
      obj.videoId = obj.videoId || n.videoId;
    }

    return res.json({ success: true, data: obj });
  } catch (e) {
    console.error("Get video error:", e);
    return res.status(400).json({ success: false, error: "Invalid video id" });
  }
});

// ✅ PUT /api/videos/:id (ADMIN)
router.put("/:id", async (req, res) => {
  try {
    const { title, url, youtubeUrl, description } = req.body;
    const update = {};

    if (title !== undefined) update.title = String(title).trim();
    if (description !== undefined) update.description = String(description);

    if (url !== undefined || youtubeUrl !== undefined) {
      const finalUrl = String(url || youtubeUrl || "").trim();
      const n = normalizeVideoUrl(finalUrl);

      if (n.provider !== "youtube") {
        return res.status(400).json({
          success: false,
          error: "Only YouTube URLs are supported. Please paste a valid YouTube link.",
        });
      }

      update.url = n.url;
      update.embedUrl = n.embedUrl;
      update.provider = n.provider;
      update.videoId = n.videoId;
    }

    const doc = await Video.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (!doc) return res.status(404).json({ success: false, error: "Video not found" });

    return res.json({ success: true, data: doc });
  } catch (e) {
    console.error("Update video error:", e);
    return res.status(400).json({ success: false, error: "Failed to update video" });
  }
});

// ✅ DELETE /api/videos/:id (ADMIN)
router.delete("/:id", async (req, res) => {
  try {
    const doc = await Video.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: "Video not found" });

    return res.json({ success: true, message: "Video deleted" });
  } catch (e) {
    console.error("Delete video error:", e);
    return res.status(400).json({ success: false, error: "Failed to delete video" });
  }
});

module.exports = router;
