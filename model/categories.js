const mongoose = require("mongoose");

const categoriesSchema = mongoose.Schema(
  {
    headTitle: {
      type: String,
      trim: true,
    },
    headKeyword: {
      type: String,
      trim: true,
    },
    headDescription: {
      type: String,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    upperCategory: {
      type: String,
      trim: true,
    },
    originalUrl: {
      type: String,
      trim: true,
    },
    manualUrl: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

const Categories = mongoose.model("categories", categoriesSchema);

module.exports = Categories;
