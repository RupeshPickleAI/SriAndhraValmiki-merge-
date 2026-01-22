// models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, trim: true, default: "" },
    lastName: { type: String, trim: true, default: "" },

    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, trim: true },

    passwordHash: { type: String, required: true },

    role: { type: String, enum: ["user", "admin"], default: "user", index: true },

    isEmailVerified: { type: Boolean, default: false },
    isPhoneVerified: { type: Boolean, default: false },

    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string" } } }
);

userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { phone: { $type: "string" } } }
);

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
