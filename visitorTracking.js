const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const auth = require("./authentication");

const VISITOR_COOKIE = "sav_visitor_id";
const visitorEventSchema = new mongoose.Schema(
  {
    visitorId: { type: String, required: true, index: true },
    path: { type: String, required: true },
    visitedAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

const VisitorEvent =
  mongoose.models.VisitorEvent || mongoose.model("VisitorEvent", visitorEventSchema);

function readCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";");
  const entry = cookies.find((cookie) => cookie.trim().startsWith(`${name}=`));
  if (!entry) return "";
  try {
    return decodeURIComponent(entry.trim().slice(name.length + 1));
  } catch {
    return "";
  }
}

function createVisitorId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function trackPublicPageView(req, res, next) {
  const acceptsHtml = String(req.headers.accept || "").includes("text/html");
  const isPublicDocument = req.method === "GET" && acceptsHtml && !req.path.startsWith("/api") && !req.path.startsWith("/uploads");

  if (!isPublicDocument) return next();

  let visitorId = readCookie(req, VISITOR_COOKIE);
  if (!visitorId || visitorId.length > 100) {
    visitorId = createVisitorId();
    res.setHeader("Set-Cookie", `${VISITOR_COOKIE}=${encodeURIComponent(visitorId)}; Max-Age=31536000; Path=/; SameSite=Lax`);
  }

  if (mongoose.connection.readyState === 1) {
    VisitorEvent.create({ visitorId, path: req.path }).catch((error) => {
      console.error("Visitor tracking error:", error.message);
    });
  }

  return next();
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

const router = express.Router();

router.get("/stats", auth.authMiddleware, auth.requireAdmin, async (_req, res) => {
  try {
    const now = new Date();
    const today = startOfUtcDay(now);
    const week = addUtcDays(today, -6);
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const uniqueVisitorCount = async (since) => {
      const ids = await VisitorEvent.distinct("visitorId", { visitedAt: { $gte: since } });
      return ids.length;
    };

    const [totalVisitors, totalPageViews, visitorsToday, visitorsThisWeek, visitorsThisMonth, recent] = await Promise.all([
      uniqueVisitorCount(new Date(0)),
      VisitorEvent.countDocuments(),
      uniqueVisitorCount(today),
      uniqueVisitorCount(week),
      uniqueVisitorCount(month),
      VisitorEvent.find({}, { _id: 0, visitorId: 0, path: 1, visitedAt: 1 }).sort({ visitedAt: -1 }).limit(20).lean(),
    ]);

    return res.json({
      success: true,
      data: {
        totalVisitors,
        totalPageViews,
        visitorsToday,
        visitorsThisWeek,
        visitorsThisMonth,
        recentActivity: recent,
      },
    });
  } catch (error) {
    console.error("Visitor stats error:", error.message);
    return res.status(500).json({ success: false, error: "Failed to load visitor statistics" });
  }
});

module.exports = { router, trackPublicPageView };
