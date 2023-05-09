const mongoose = require("mongoose");

function validatorGTZ(value) {
  return value >= 0;
}
const many = [
  { validator: validatorGTZ, msg: "TaggedNumber at least should be zero!" },
  { validator: Number.isInteger, msg: "TaggedNumber is not an integer!" },
];
const tagsSchema = mongoose.Schema(
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
    originalUrl: {
      type: String,
      trim: true,
    },
    manualUrl: {
      type: String,
      trim: true,
    },
    sorting: {
      type: Number,
      trim: true,
    },
    pageView: {
      type: Number,
      trim: true,
      default: 0,
    },
    popular: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

const Tag = mongoose.model("tags", tagsSchema);

module.exports = Tag;
