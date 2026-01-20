// notificationRoutes.js
const express = require("express");
const router = express.Router();
const Notification = require("./models/Notification");

// ✅ CREATE
// POST /api/notifications
router.post("/", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: "text is required" });
    }

    // allow optional targetUserId to send notifications to a specific user only
    const payload = { text: text.trim(), isRead: false };
    if (req.body.targetUserId) payload.targetUserId = req.body.targetUserId;

    const doc = await Notification.create(payload);

    res.json({ success: true, message: "Notification created", data: doc });
  } catch (err) {
    console.error("Create notification error:", err);
    res.status(500).json({ success: false, error: "Failed to create notification" });
  }
});

// ✅ LIST
// GET /api/notifications
router.get("/", async (req, res) => {
  try {
    // If client provides userId, return both global notifications and those targeted at that user
    const { userId } = req.query;
    const q = {};
    if (userId) {
      q.$or = [{ targetUserId: userId }, { targetUserId: { $exists: false } }];
    }
    const list = await Notification.find(q).sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) {
    console.error("List notifications error:", err);
    res.status(500).json({ success: false, error: "Failed to fetch notifications" });
  }
});

// ✅ GET ONE
// GET /api/notifications/:id
router.get("/:id", async (req, res) => {
  try {
    const doc = await Notification.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: "Notification not found" });
    res.json({ success: true, data: doc });
  } catch (err) {
    console.error("Get notification error:", err);
    res.status(400).json({ success: false, error: "Invalid notification id" });
  }
});

// ✅ UPDATE (text + isRead)
// PUT /api/notifications/:id
router.put("/:id", async (req, res) => {
  try {
    const { text, isRead } = req.body;

    const update = {};
    if (typeof text === "string" && text.trim()) update.text = text.trim();
    if (typeof isRead === "boolean") update.isRead = isRead;

    const doc = await Notification.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });

    if (!doc) return res.status(404).json({ success: false, error: "Notification not found" });

    res.json({ success: true, message: "Notification updated", data: doc });
  } catch (err) {
    console.error("Update notification error:", err);
    res.status(400).json({ success: false, error: "Failed to update notification" });
  }
});

// ✅ DELETE
// DELETE /api/notifications/:id
router.delete("/:id", async (req, res) => {
  try {
    const doc = await Notification.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ success: false, error: "Notification not found" });

    res.json({ success: true, message: "Notification deleted" });
  } catch (err) {
    console.error("Delete notification error:", err);
    res.status(400).json({ success: false, error: "Failed to delete notification" });
  }
});

module.exports = router;
