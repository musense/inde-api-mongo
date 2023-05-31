const express = require("express");
const Tags = require("../model/tags");
const Sitemap = require("../model/sitemap");
const Editor = require("../model/editor");
require("dotenv").config();

const tagRouter = new express.Router();
const domain = process.env.DOMAIN;

//set session verify
const verifyUser = (req, res, next) => {
  if (req.session.isVerified) {
    next();
  } else {
    return res.status(404).json({ message: "Please login first" });
  }
};

async function getTag(req, res, next) {
  const id = req.params.id;

  let tag;
  try {
    tag = await Tags.findOne({ _id: id }).select("-updatedAt -createdAt -__v");
    if (tag === undefined) {
      return res.status(404).json({ message: "can't find tag!" });
    }
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
  res.tag = tag;
  next();
}

function isPositiveInteger(input) {
  return typeof input === "number" && Number.isInteger(input) && input > 0;
}

function parseQuery(req, res, next) {
  let pageNumber = req.query.pageNumber;
  let limit = req.query.limit;

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

async function updateSorting(req, res, method, popular, next) {
  const desiredSorting = req.body.sorting;
  const lastTag = await Tags.findOne().sort({ sorting: -1 });
  const maxSorting = lastTag ? lastTag.sorting + 1 : 1;

  if (!desiredSorting && !popular) {
    res.sorting = null;
    return;
  } else if (!desiredSorting && popular) {
    if (method === "POST") {
      res.sorting = maxSorting;
      return;
    }
    if (method === "PATCH") {
      //Do nothing keep going
    }
  }

  let existingTagId = null;
  let targetTag;
  if (desiredSorting) {
    targetTag = await Tags.findOne({ sorting: desiredSorting });
    res.targetTag = targetTag;
  } else {
    targetTag = null;
    res.targetTag = null;
  }

  if (method === "POST") {
    if (targetTag) {
      targetTag.sorting = maxSorting;
      await targetTag.save();

      res.targetOriginalSorting = desiredSorting;
      res.targetChangeSorting = maxSorting;
      res.sorting = desiredSorting;
      return;
    } else {
      res.sorting = desiredSorting;
      return;
    }
  }
  if (method === "PATCH") {
    existingTagId = req.params.id;
    let existingTag = await Tags.findById(existingTagId);
    //原本資料有值, 與目標交換
    if (targetTag && existingTag.sorting) {
      let targetSorting = targetTag.sorting;
      let existingSorting = existingTag.sorting;
      targetTag.sorting = existingSorting;
      await targetTag.save();

      res.targetOriginalSorting = targetSorting;
      res.targetChangeSorting = existingSorting;
      res.sorting = targetSorting;
      return;
    } else if (targetTag && !existingTag.sorting) {
      //原本資料沒有值, 將目標資料放到最後
      targetTag.sorting = maxSorting;
      await targetTag.save();

      res.targetOriginalSorting = desiredSorting;
      res.targetChangeSorting = maxSorting;
      res.sorting = desiredSorting;
      return;
    } else if (!targetTag && !existingTag.sorting) {
      res.sorting = maxSorting;
      return;
    } else if (!targetTag && existingTag.sorting) {
      res.sorting = desiredSorting;
      return;
    }
    next();
  }
}

//後台文章編輯時取出所有標籤與標籤管理頁面用
tagRouter.get("/tags", parseQuery, async (req, res) => {
  const { startDate, endDate, pageNumber, limit } = req.query;
  const skip = pageNumber ? (pageNumber - 1) * limit : 0;
  const nameQuery = req.query.name;

  const query = {};

  let start;
  let end;

  if (startDate) {
    start = new Date(Number(startDate));
    if (isNaN(start)) {
      res.status(400).send({
        message:
          "Invalid startDate. It must be a valid date format or a timestamp.",
      });
      return;
    }
  }

  if (endDate) {
    end = new Date(Number(endDate));
    if (isNaN(end)) {
      res.status(400).send({
        message:
          "Invalid endDate. It must be a valid date format or a timestamp.",
      });
      return;
    }
  }

  if (end && start && end <= start) {
    res.status(400).send({
      message: "End date cannot be smaller than or equal to start date.",
    });
    return;
  }
  if (startDate && endDate) {
    query.createdAt = { $gte: start, $lt: end };
  } else if (startDate) {
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 1);
    query.createdAt = { $gte: start, $lt: end };
  }

  if (nameQuery) {
    const namesArray = nameQuery.split(",");
    const nameQueries = namesArray.map((name) => ({
      name: { $regex: name, $options: "i" },
    }));
    query.$or = nameQueries;
  }

  const tagList = await Tags.find(query)
    .sort({ sorting: 1, createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const totalDocs = await Tags.countDocuments(query).exec();

  const result = {
    data: tagList,
    totalCount: totalDocs,
    totalPages: Math.ceil(totalDocs / limit),
    limit: limit,
    currentPage: pageNumber,
  };

  try {
    res.status(200).send(result);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

tagRouter.get("/tags/tagSearch/:name", parseQuery, async (req, res) => {
  const tagName = req.params.name;
  const { pageNumber, limit } = req.query;
  const skip = pageNumber ? (pageNumber - 1) * limit : 0;

  try {
    const tagData = await Tags.findOne({ name: tagName }).select("_id");

    const editorsInTag = await Editor.find({
      tags: tagData._id,
      hidden: false,
    })
      .select("-content -htmlContent")
      .populate({ path: "categories", select: "name" })
      .populate({ path: "tags", select: "name" })
      .sort({ updatedAt: -1 })
      .limit(limit)
      .skip(skip);

    const totalDocs = await Editor.countDocuments({
      tags: tagData._id,
    }).exec();

    const result = {
      data: editorsInTag,
      totalCount: totalDocs,
      totalPages: limit > 0 ? Math.ceil(totalDocs / limit) : 1,
      limit: limit,
      currentPage: pageNumber,
    };

    res.status(200).send(result);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

tagRouter.get("/tags/:name", async (req, res) => {
  try {
    const tagName = req.params.name;

    let tag;
    try {
      tag = await Tags.findOne({ name: tagName }).select(
        "-updatedAt -createdAt -__v"
      );
      if (tag === undefined) {
        return res.status(404).json({ message: "can't find tag!" });
      }
    } catch (err) {
      return res.status(500).send({ message: err.message });
    }

    res.status(200).send(tag);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

tagRouter.post(
  "/tags",
  verifyUser,
  async (req, res, next) => {
    try {
      if (req.body.sorting && !req.body.popular) {
        return res.status(400).send({
          message: "The 'popular' field must be set to true to update sorting.",
        });
      }
      await updateSorting(req, res, "POST", req.body.popular, next);
      next();
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  },
  async (req, res) => {
    const {
      headTitle,
      headKeyword,
      headDescription,
      name,
      popular,
      manualUrl,
    } = req.body;
    const { sorting, targetTag, targetOriginalSorting, targetChangeSorting } =
      res;
    const originalUrl = `${domain}tag_${name}.html`;

    let message = "";
    if (!name) {
      message += "name is required\n";
    }
    if (sorting) {
      if (!parseInt(sorting, 10) || parseInt(sorting, 10) < 0) {
        message += "sorting must be a positive integer\n";
      }
    }
    if (message) {
      res.status(400).send({ message });
    } else {
      const tag = new Tags({
        headTitle,
        headKeyword,
        headDescription,
        name,
        sorting,
        popular,
        originalUrl,
        manualUrl,
      });
      try {
        const newTag = await tag.save();
        //save sitemap
        let newTagSitemap;

        if (newTag) {
          let newTagUrl;
          if (newTag.manualUrl) {
            newTagUrl = `${domain}tag_${newTag.manualUrl}.html`;
          } else {
            newTagUrl = newTag.originalUrl;
          }

          newTagSitemap = new Sitemap({
            url: newTagUrl,
            originalID: newTag._id,
            type: "tag",
          });
          await newTagSitemap.save();
        }

        res.status(201).json({
          newTag: newTag,
          targetTagID: targetTag ? targetTag._id : null,
          targetTagName: targetTag ? targetTag.name : null,
          targetOriginalSorting: targetOriginalSorting,
          targetChangeSorting: targetChangeSorting,
        });
      } catch (e) {
        res.status(500).send({ message: e.message });
      }
    }
  }
);

tagRouter.patch(
  "/tags/:id",
  verifyUser,
  getTag,
  async (req, res, next) => {
    try {
      if (req.body.sorting && !req.body.popular) {
        return res.status(400).send({
          message: "The 'popular' field must be set to true to update sorting.",
        });
      }
      await updateSorting(req, res, "PATCH", req.body.popular, next);
      next();
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  },
  async (req, res, next) => {
    const {
      headTitle,
      headKeyword,
      headDescription,
      name,
      popular,
      manualUrl,
    } = req.body;
    // let manualUrl = req.body.webHeader.href;

    // console.log(req.body.webHeader.href);
    // console.log(manualUrl);
    const { sorting, targetTag, targetOriginalSorting, targetChangeSorting } =
      res;

    if (manualUrl) {
      res.tag.manualUrl = manualUrl;
      await Sitemap.updateOne(
        { originalID: res.tag._id, type: "tag" },
        { $set: { url: `${domain}tag_${manualUrl}.html` } }
      );
    }
    if (name) res.tag.name = name;
    if (sorting) res.tag.sorting = sorting;
    if (popular === false && !sorting) {
      res.tag.sorting = null;
      res.tag.popular = popular;
    } else if (popular) {
      res.tag.popular = popular;
    }
    if (headTitle) res.tag.headTitle = headTitle;
    if (headKeyword) res.tag.headKeyword = headKeyword;
    if (headDescription) res.tag.headDescription = headDescription;

    try {
      const updateTag = await res.tag.save();
      res.status(201).json({
        updateTag: updateTag,
        targetTagID: targetTag ? targetTag._id : null,
        targetTagName: targetTag ? targetTag.name : null,
        targetOriginalSorting: targetOriginalSorting,
        targetChangeSorting: targetChangeSorting,
      });
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  }
);

tagRouter.delete("/tags/bunchDeleteByIds", verifyUser, async (req, res) => {
  try {
    const ids = req.body.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: "Invalid data." });
    }
    const existingTags = await Tags.find({ _id: { $in: ids } }).select("_id");

    if (existingTags.length !== ids.length) {
      return res
        .status(400)
        .json({ message: "Some of the provided Tag IDs do not exist." });
    }

    const deleteSitemap = await Sitemap.deleteMany({
      originalID: { $in: ids },
      type: "tag",
    });

    const deleteTags = await Tags.deleteMany({
      _id: { $in: ids },
    });
    if (deleteTags.deletedCount === 0) {
      return res.status(404).json({ message: "No matching Tag found" });
    }
    if (deleteTags.deletedCount !== deleteSitemap.deletedCount) {
      return res.status(404).json({ message: "No matching sitemap found" });
    }

    res.status(201).json({
      message: `Deleted ${deleteTags.deletedCount} tags successfully!`,
    });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

module.exports = tagRouter;
