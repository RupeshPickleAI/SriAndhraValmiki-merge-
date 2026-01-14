// models/Notification.js
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    // Optional: target a specific user. If absent, notification is global (for all users)
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false, index: true },
    // Legacy single isRead flag (keeps compatibility). Consider migrating to per-user read tracking later.
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
  