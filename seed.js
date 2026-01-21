// seed.js - Seed test data to MongoDB
require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/User");

const MONGODB_URI_GLOBAL = process.env.MONGODB_URI_GLOBAL || "mongodb+srv://rupesh:rupesh@rupesh.peoycon.mongodb.net/valmiki?retryWrites=true&w=majority";

async function seedDatabase() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI_GLOBAL);
    console.log("✅ Connected to MongoDB");

    // Delete existing test users
    await User.deleteMany({ email: { $in: ["rupesh@trashmailr.com", "test@example.com", "admin@test.com"] } });
    console.log("🗑️  Deleted existing test users");

    // Create test user
    const passwordHash = await bcrypt.hash("password123", 10);
    
    const testUser = await User.create({
      firstName: "Rupesh",
      lastName: "Nitin",
      email: "rupesh@trashmailr.com",
      passwordHash,
      password: passwordHash,
      role: "user",
      isEmailVerified: true,
      isPhoneVerified: false,
    });
    console.log("✅ Test user created:", testUser.email);

    // Create admin user
    const adminPasswordHash = await bcrypt.hash("rama@2026", 10);
    const adminUser = await User.create({
      firstName: "Admin",
      lastName: "User",
      email: "sriandhravalmiki@gmail.com",
      passwordHash: adminPasswordHash,
      password: adminPasswordHash,
      role: "admin",
      isEmailVerified: true,
      isPhoneVerified: false,
    });
    console.log("✅ Admin user created:", adminUser.email);

    console.log("\n✅ Database seeded successfully!");
    console.log("\n🔐 Test Credentials:");
    console.log("Email: rupesh@trashmailr.com");
    console.log("Password: password123");
    console.log("\nAdmin Credentials:");
    console.log("Email: sriandhravalmiki@gmail.com");
    console.log("Password: rama@2026");

    process.exit(0);
  } catch (err) {
    console.error("❌ Error seeding database:", err.message);
    process.exit(1);
  }
}

seedDatabase();
