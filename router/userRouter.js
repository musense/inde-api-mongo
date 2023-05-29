const express = require("express");
const User = require("../model/user");
const bcrypt = require("bcrypt");
const saltRounds = 10; // 8, 10, 12, 14

const userRouter = new express.Router();

const verifyUser = (req, res, next) => {
  if (req.session.isVerified) {
    next();
  } else {
    return res.status(404).json({ message: "Please login first" });
  }
};

async function getUser(req, res, next) {
  const { username } = req.params;
  console.log(`getUser req.params.username: ${req.params.username}`);
  let user;
  try {
    user = await User.findOne({ username });
    // return res.json(user)
    if (user == undefined) {
      return res.status(404).json({ message: "can't find user!" });
    }
  } catch (e) {
    return res.status(500).send({ message: e.message });
  }
  res.user = user;
  next();
}

userRouter.get("/user", verifyUser, async (req, res) => {
  try {
    const userList = await User.find().limit(10).sort({ username: 1 });
    // console.log(`router get user: ${JSON.stringify(res.json(user))}`)
    res.send(userList);
  } catch (e) {
    res.status(500).send({ message: e.message });
  }
});

userRouter.post("/login", async (req, res) => {
  const { username, password } = req.body;
  let user;
  const regexEmail = /\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+/;
  const validateEmail = (email) => regexEmail.test(email);

  try {
    // 檢查 `username` 是否符合電子郵件格式
    const isEmail = validateEmail(username);

    // 根據 `username` 是否為電子郵件查找用戶
    if (isEmail) {
      user = await User.findOne({ email: username }).exec();
    } else {
      user = await User.findOne({ username }).exec();
    }

    if (!user) {
      return res.status(404).json({ message: "can't find user!" });
    }

    let result = await bcrypt.compare(password, user.password);
    if (result) {
      req.session.isVerified = true;
      req.session.user = user.username;
      return res.status(200).send(user);
    } else {
      return res.status(404).json({ message: "login failed" });
    }
  } catch (err) {
    // 處理錯誤，例如返回一個適當的錯誤響應
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
  }
});

//logout
userRouter.post("/logout", async (req, res) => {
  req.session.destroy();
  return res.send("You had been logout");
});

// register
userRouter.post("/register", async (req, res) => {
  const { email, username, password } = req.body;
  const regexLowercase = /^(?=.*[a-z])/;
  const regexUppercase = /^(?=.*[A-Z])/;
  const regexMinLength = /[0-9a-zA-Z]{6,}/;

  let checkLowercase = regexLowercase.test(password);
  let checkUppercase = regexUppercase.test(password);
  let checkMinLength = regexMinLength.test(password);

  try {
    let checkUser = await User.findOne({ username: username });
    let checkEmail = await User.findOne({ email: email });
    let errors = [];
    if (!checkLowercase) {
      errors.push("Password must contain at least one lowercase letter.");
    }
    if (!checkUppercase) {
      errors.push("Password must contain at least one uppercase letter.");
    }
    if (!checkMinLength) {
      errors.push("Password must be at least 6 characters.");
    }
    if (checkUser) {
      errors.push("username has been used");
    }
    if (checkEmail) {
      errors.push("email has been used");
    }
    if (errors.length > 0) {
      return res.status(400).json({ messages: errors });
    }
    const postHash = await bcrypt.hash(password, saltRounds);
    const newUser = new User({ email, username, password: postHash });
    const saveUser = await newUser.save();
    const registerUserSuccess = Object.assign({}, saveUser["_doc"], {
      errorMessage: "register successfully",
    });
    res.status(201).json(registerUserSuccess);
  } catch (e) {
    res.status(500).send({ message: e.message });
  }
});

// delete user account
userRouter.delete("/user/:username", verifyUser, getUser, async (req, res) => {
  try {
    await res.user.remove();
    res.json({ message: "Delete user successful!" });
  } catch (e) {
    res.status(500).send({ message: e.message });
  }
});

// modify user account
userRouter.patch("/user/:username", verifyUser, getUser, async (req, res) => {
  const { email, password } = req.body;
  try {
    const patchHash = await bcrypt.hash(password, saltRounds);
    if (email != null) res.user.email = email;
    if (password != null) res.user.password = patchHash;

    // throw new Error('update error!!!')
    const updateUser = await res.user.save();
    res.json(updateUser);
  } catch (e) {
    res.status(500).send({ message: e.message });
  }
});

module.exports = userRouter;
