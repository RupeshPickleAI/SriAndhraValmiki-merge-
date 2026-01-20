// models/Notification.js
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false, index: true },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
