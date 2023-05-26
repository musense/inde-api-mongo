// const { ObjectId } = require('mongodb')
const mongoose = require("mongoose");

const regexEmail = /\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+/;
const validateEmail = (email) => regexEmail.test(email);

// const regexAtLeastOneDigit = /(?=.*\d)/;
const regexAtLeastOneLowerCase = /(?=.*[a-z])/;
const regexAtLeastOneUpperCase = /(?=.*[A-Z])/;
const regexAtLeastEightCharacters = /[0-9a-zA-Z]{6,}/;

// const validatorAtLeastOneDigit = (pwd) => regexAtLeastOneDigit.test(pwd);
const validatorAtLeastOneLowerCase = (pwd) =>
  regexAtLeastOneLowerCase.test(pwd);
const validatorAtLeastOneUpperCase = (pwd) =>
  regexAtLeastOneUpperCase.test(pwd);
const validatorAtLeastEightCharacters = (pwd) =>
  regexAtLeastEightCharacters.test(pwd);

const validatePasswordMany = [
  // {
  //   validator: validatorAtLeastOneDigit,
  //   msg: "password should at least contain one digit!",
  // },
  {
    validator: validatorAtLeastOneLowerCase,
    msg: "password should at least contain one lower case!",
  },
  {
    validator: validatorAtLeastOneUpperCase,
    msg: "password should at least contain one upper case!",
  },
  {
    validator: validatorAtLeastEightCharacters,
    msg: "password should at least 8 characters!",
  },
];
const userSchema = mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      validate: [validateEmail, "email not valid!"],
    },
    username: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      trim: true,
      validate: validatePasswordMany,
    },
  },
  {
    timestamps: true,
  }
);

const User = mongoose.model("user", userSchema);

module.exports = User;
