const express = require("express");
const Categories = require("../model/categories");
const Sitemap = require("../model/sitemap");
const Editor = require("../model/editor");
require("dotenv").config();

const categoryRouter = new express.Router();
const domain = process.env.DOMAIN;

//set session verify
const verifyUser = (req, res, next) => {
  if (req.session.isVerified) {
    next();
  } else {
    return res.status(404).json({ message: "Please login first" });
  }
};

async function parseCategoryName(req, res, next) {
  let categoryName = req.body.name;

  let existingCategory;
  if (req.method === "POST" || (req.method === "PATCH" && categoryName)) {
    existingCategory = await Categories.findOne({
      name: categoryName,
    }).select("-_id name");
  }
  if (existingCategory && req.method === "POST") {
    res.status(400).send({ message: "The category name already exists." });
    return;
  }
  if (existingCategory === null && req.method === "PATCH") {
    res.status(400).send({ message: "The category doesn't exists." });
    return;
  }

  res.name = categoryName;
  next();
}

async function parseUpperCategory(req, res, next) {
  const upperCategory = req.body.upperCategory;
  if (upperCategory) {
    //確認是否為現存的分類
    const checkCategory = await Categories.findOne({ name: upperCategory });
    if (!checkCategory) {
      return res
        .status(404)
        .json({ message: "This uppercategory does not exist" });
    }
    //確認是否存在於文章分類裡, 有的話則不能當作上層分類
    const checkEditor = await Editor.findOne({ categories: checkCategory._id });

    if (checkEditor || upperCategory === "upperCategory") {
      return res
        .status(404)
        .json({ message: "This category cannot be uppercategory" });
    }
    res.upperCategory = checkCategory;
    next();
  } else {
    if (req.method === "POST") {
      res.upperCategory = null;
    }
    if (req.method === "PATCH") {
      if (upperCategory === null) {
        res.upperCategory = null;
      } else {
        res.upperCategory = undefined;
      }
    }
    next();
  }
}

function parseRequestBody(req, res, next) {
  const { headTitle, headKeyword, headDescription, manualUrl } = req.body;

  if (req.method === "POST") {
    res.headTitle = headTitle ?? null;
    res.headKeyword = headKeyword ?? null;
    res.headDescription = headDescription ?? null;
    res.manualUrl = manualUrl ?? null;
  }

  if (req.method === "PATCH") {
    res.headTitle = headTitle;
    res.headKeyword = headKeyword;
    res.headDescription = headDescription;
    res.manualUrl = manualUrl;
  }
  next();
}

function isPositiveInteger(input) {
  return typeof input === "number" && Number.isInteger(input) && input > 0;
}

function parseQuery(req, res, next) {
  let pageNumber = req.query.pageNumber;
  let limit = req.query.limit;

  // if (limit === undefined) {
  //   return res.status(400).send({
  //     message: "Invalid limit. It must be a positive integer.",
  //   });
  // }

  if (pageNumber !== undefined) {
    pageNumber = parseInt(pageNumber, 10);
    if (!isPositiveInteger(pageNumber)) {
      return res.status(400).send({
        message: "Invalid pageNumber. It must be a positive integer.",
      });
    }
  }
  if (limit !== undefined) {
    limit = parseInt(limit, 10);
    if (!isPositiveInteger(limit)) {
      return res.status(400).send({
        message: "Invalid limit. It must be a positive integer.",
      });
    }
  }

  req.pageNumber = pageNumber;
  req.limit = limit;
  next();
}

async function getSpecificClassifications(id, limit, pageNumber) {
  const skip = pageNumber ? (pageNumber - 1) * limit : 0;

  const editors = await Editor.find({
    categories: id,
    hidden: false,
  })
    .select(
      "serialNumber title categories tags homeImagePath contentImagePath createdAt"
    )
    .populate({ path: "categories", select: "name" })
    .populate({ path: "tags", select: "name" })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .skip(skip);

  const totalDocs = await Editor.countDocuments({
    categories: id,
  }).exec();

  const result = {
    data: editors,
    totalCount: totalDocs,
    totalPages: limit > 0 ? Math.ceil(totalDocs / limit) : 1,
    limit: limit,
    currentPage: pageNumber,
  };
  return result;
}

async function createSitemap(sitemapUrl, originalID) {
  const newCategorySitemap = new Sitemap({
    url: sitemapUrl,
    originalID: originalID,
    type: "category",
  });
  await newCategorySitemap.save();
}

async function getCategory(req, res, next) {
  const id = req.params.id;

  let category;
  try {
    category = await Categories.findOne({ _id: id }).select(
      "-updatedAt -createdAt -__v"
    );
    if (category === undefined) {
      return res.status(404).json({ message: "can't find editor!" });
    }
  } catch (e) {
    return res.status(500).send({ message: e.message });
  }
  res.category = category;
  next();
}

//後台文章分類編輯處列出所有文章分類
categoryRouter.get("/categories", parseQuery, async (req, res) => {
  try {
    const { pageNumber, limit } = req;
    const skip = pageNumber ? (pageNumber - 1) * 10 : 0;

    const allCategories = await Categories.find()
      .select("-__v")
      .skip(skip)
      .limit(limit);

    const totalDocs = await Categories.countDocuments().exec();

    const updatedCategories = await Promise.all(
      allCategories.map(async (category) => {
        const sitemapUrl = await Sitemap.findOne({
          originalID: category._id,
          type: "category",
        });
        if (sitemapUrl) {
          category = category.toObject(); // convert mongoose document to plain javascript object
          category.sitemapUrl = sitemapUrl.url; // add url property
        }
        return category;
      })
    );

    const result = {
      data: updatedCategories,
      totalCount: totalDocs,
      totalPages: Math.ceil(totalDocs / limit),
      limit: limit,
      currentPage: pageNumber,
    };
    res.send(result);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

//首頁分類文章:Lottery
categoryRouter.get("/categories/lottery", parseQuery, async (req, res) => {
  const { pageNumber, limit } = req.query;
  try {
    const categoryInfo = await Categories.findOne({ name: "lottery" }).select(
      "_id"
    );
    const result = await getSpecificClassifications(
      categoryInfo._id,
      limit,
      pageNumber
    );

    res.status(200).send(result);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

//首頁分類文章:sports
categoryRouter.get("/categories/sports", parseQuery, async (req, res) => {
  const { pageNumber, limit } = req.query;
  try {
    const categoryInfo = await Categories.findOne({ name: "sports" }).select(
      "_id"
    );
    const result = await getSpecificClassifications(
      categoryInfo._id,
      limit,
      pageNumber
    );

    res.status(200).send(result);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

//首頁分類文章:poker
categoryRouter.get("/categories/poker", parseQuery, async (req, res) => {
  const { pageNumber, limit } = req.query;
  try {
    const categoryInfo = await Categories.findOne({ name: "poker" }).select(
      "_id"
    );
    const result = await getSpecificClassifications(
      categoryInfo._id,
      limit,
      pageNumber
    );

    res.status(200).send(result);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

//首頁分類文章:matka
categoryRouter.get("/categories/matka", parseQuery, async (req, res) => {
  const { pageNumber, limit } = req.query;
  try {
    const categoryInfo = await Categories.findOne({ name: "matka" }).select(
      "_id"
    );
    const result = await getSpecificClassifications(
      categoryInfo._id,
      limit,
      pageNumber
    );

    res.status(200).send(result);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

//首頁分類文章:casino
categoryRouter.get("/categories/casino", parseQuery, async (req, res) => {
  const { pageNumber, limit } = req.query;
  try {
    const categoryInfo = await Categories.findOne({ name: "casino" }).select(
      "_id"
    );
    const result = await getSpecificClassifications(
      categoryInfo._id,
      limit,
      pageNumber
    );

    res.status(200).send(result);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

categoryRouter.get("/category/:name", async (req, res) => {
  const categoryName = req.params.name;
  try {
    const categoryInfo = await Categories.findOne({
      name: categoryName,
    }).select("-__v");
    if (!categoryInfo) {
      return res.status(404).json({ message: "can't find category!" });
    }
    res.status(200).send(categoryInfo);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

//Menubar列出上層文章分類與子分類
categoryRouter.get("/categories/upper_category", async (req, res) => {
  try {
    const categories = await Categories.find().select("name upperCategory");
    const upperCategories = {};

    categories.forEach((category) => {
      const upperCategory = category.upperCategory;
      if (!upperCategories[upperCategory]) {
        upperCategories[upperCategory] = [];
      }
      upperCategories[upperCategory].push({
        _id: category._id,
        name: category.name,
      });
    });

    const result = {
      data: upperCategories,
    };

    res.send(result);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

//點選上層分類後列出子分類所有文章
categoryRouter.get("/categories/:upperCategory", async (req, res) => {
  const upperName = req.params.upperCategory;
  try {
    const categoriesName = await Categories.find({
      upperCategory: upperName,
    }).select("-_id name");

    const totalDocs = await Categories.countDocuments({
      upperCategory: upperName,
    }).exec();

    const result = {
      data: categoriesName,
      totalCount: totalDocs,
    };

    res.send(result);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

//新增文章分類
categoryRouter.post(
  "/categories",
  verifyUser,
  parseRequestBody,
  parseCategoryName,
  parseUpperCategory,
  async (req, res) => {
    const {
      headTitle,
      headKeyword,
      headDescription,
      name,
      upperCategory,
      manualUrl,
    } = res;

    let message = "";
    if (name === null) {
      message += "name is required\n";
    }
    if (message) {
      res.status(400).send({ message });
    }

    try {
      const newCategory = new Categories({
        headTitle,
        headKeyword,
        headDescription,
        name,
        upperCategory,
        manualUrl,
      });

      await newCategory.save();

      //save URL & sitemap
      let originalUrl;
      let sitemapUrl;

      if (upperCategory) {
        originalUrl = `${domain}c_${upperCategory._id}/c_${newCategory._id}.html`;
        let upperCategorySitemap = await Sitemap.findOne({
          originalID: upperCategory._id,
          type: "category",
        });
        let upperCategoryUrl = upperCategorySitemap.url;

        if (newCategory.manualUrl) {
          sitemapUrl = `${upperCategoryUrl}/c_${newCategory.manualUrl}.html`;
          await createSitemap(sitemapUrl, newCategory._id);
        } else {
          sitemapUrl = `${upperCategoryUrl}/c_${newCategory._id}.html`;
          await createSitemap(sitemapUrl, newCategory._id);
        }
      } else {
        originalUrl = `${domain}c_${newCategory._id}.html`;
        if (manualUrl) {
          sitemapUrl = `${domain}c_${manualUrl}.html`;
        } else {
          sitemapUrl = originalUrl;
        }
        await createSitemap(sitemapUrl, newCategory._id);
      }
      await Categories.updateOne(
        { _id: newCategory.id },
        { $set: { originalUrl: originalUrl } }
      );

      res.status(201).json(newCategory);
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  }
);

categoryRouter.patch(
  "/categories/:id",
  verifyUser,
  parseRequestBody,
  parseCategoryName,
  parseUpperCategory,
  getCategory,
  async (req, res) => {
    const {
      headTitle,
      headKeyword,
      headDescription,
      // name,
      upperCategory,
      manualUrl,
    } = res;

    // if (name) res.category.name = name;
    if (upperCategory !== undefined)
      res.category.upperCategory = upperCategory.name;
    if (headTitle !== undefined) res.category.headTitle = headTitle;
    if (headKeyword !== undefined) res.category.headKeyword = headKeyword;
    if (headDescription !== undefined)
      res.category.headDescription = headDescription;
    if (manualUrl !== undefined) res.category.manualUrl = manualUrl;

    // console.log(res.category);
    try {
      const updateCategory = await res.category.save();

      //save URL & sitemap
      let sitemapUrl;
      const originalSitemap = await Sitemap.findOne({
        originalID: updateCategory._id,
        type: "category",
      });

      if (upperCategory) {
        let upperCategorySitemap = await Sitemap.findOne({
          originalID: upperCategory._id,
          type: "category",
        });
        let upperCategoryUrl = upperCategorySitemap.url.replace(/\.html$/, "");

        if (updateCategory.manualUrl) {
          sitemapUrl = `${upperCategoryUrl}/c_${updateCategory.manualUrl}.html`;
          originalSitemap.url = sitemapUrl;
          await originalSitemap.save();
        } else {
          sitemapUrl = `${upperCategoryUrl}/c_${updateCategory._id}.html`;
          originalSitemap.url = sitemapUrl;
          await originalSitemap.save();
        }
      } else {
        if (manualUrl) {
          let parts = originalSitemap.url.split("/");
          parts.splice(-1, 1, `c_${manualUrl}.html`);
          let updatedUrl = parts.join("/");
          originalSitemap.url = updatedUrl;
          await originalSitemap.save();
        }
      }
      res.status(201).json(updateCategory);
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  }
);

categoryRouter.delete(
  "/categories/bunchDeleteByIds",
  verifyUser,
  async (req, res) => {
    try {
      const ids = req.body.ids;

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "Invalid data." });
      }

      const existingCategories = await Categories.find({
        _id: { $in: ids },
      }).select("_id manualUrl name");

      if (existingCategories.length !== ids.length) {
        return res
          .status(400)
          .json({ message: "Some of the provided Category IDs do not exist." });
      }

      for (const category of existingCategories) {
        let searchString;
        if (category.manualUrl) {
          searchString = `c_${category.manualUrl}`;
        } else {
          searchString = `c_${category._id}`;
        }

        const sitemapsToUpdate = await Sitemap.find({
          url: { $regex: `/${searchString}/` },
          type: "category",
        });

        // 在 JavaScript 中手動更新 URL
        for (const sitemap of sitemapsToUpdate) {
          sitemap.url = sitemap.url.replace(`/${searchString}`, "");
          await sitemap.save();
        }
        await Categories.updateMany(
          { upperCategory: category.name },
          { $set: { upperCategory: null } }
        );
      }

      const deleteSitemap = await Sitemap.deleteMany({
        originalID: { $in: ids },
        type: "category",
      });

      const deleteCategories = await Categories.deleteMany({
        _id: { $in: ids },
      });
      if (deleteCategories.deletedCount === 0) {
        return res.status(404).json({ message: "No matching Category found" });
      }
      if (deleteCategories.deletedCount !== deleteSitemap.deletedCount) {
        return res.status(404).json({ message: "No matching sitemap found" });
      }

      res.status(200).json({
        message: `Deleted ${deleteCategories.deletedCount} categories successfully!`,
      });
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  }
);

module.exports = categoryRouter;
