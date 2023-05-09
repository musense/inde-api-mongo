const mongoose = require("mongoose");

const sitemapSchema = mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    changefreq: {
      type: String,
      trim: true,
      required: false,
      default: "daily",
    },
    priority: {
      type: Number,
      required: false,
      trim: true,
      default: 0.9,
    },
    originalID: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const Sitemap = mongoose.model("sitemap", sitemapSchema);

module.exports = Sitemap;
