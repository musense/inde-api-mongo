require("dotenv").config();
const mongoose = require("mongoose");

const connstr = process.env.CON_STR;

mongoose.set("strictQuery", true);

mongoose.connect(connstr, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;

db.on("error", (err) => {
  console.error.bind(console, "connection error:");
});

db.once("open", function () {
  console.log("Connected to MongoDB");
});
