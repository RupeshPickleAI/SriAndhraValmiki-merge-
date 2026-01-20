// models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, trim: true, default: "" },
    lastName: { type: String, trim: true, default: "" },

    // keep fields optional, but unique only when they are real strings (via partial indexes below)
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true }, // E.164

    passwordHash: { type: String, required: true },

    role: { type: String, enum: ["user", "admin"], default: "user", index: true },

    isEmailVerified: { type: Boolean, default: false },
    isPhoneVerified: { type: Boolean, default: false },

    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// ✅ Unique only when value is a STRING (prevents dup key on null)
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string" } } }
);

userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: "string" } } }
);

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
