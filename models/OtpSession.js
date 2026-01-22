// models/OtpSession.js
const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ["email", "sms"], required: true },
    identifier: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },

    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    used: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// TTL
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.OtpSession || mongoose.model("OtpSession", otpSchema);
