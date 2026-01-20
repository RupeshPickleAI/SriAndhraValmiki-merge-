// models/OtpSession.js
const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema(
  {
    channel: { type: String, enum: ["email", "sms"], required: true },
    identifier: { type: String, required: true, index: true }, // normalized email or phone
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    otpHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },

    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    used: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// TTL: auto delete after expiresAt
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.OtpSession || mongoose.model("OtpSession", otpSchema);
