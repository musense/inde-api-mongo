const express = require("express");
// const { json2html } = require("html2json");
const Editor = require("../model/editor");
const Sitemap = require("../model/sitemap");
const Categories = require("../model/categories");
const Tags = require("../model/tags");
const tempEditor = require("../model/tempEditor");
const multer = require("multer");
const sharp = require("sharp");
const fs = require("fs");
const slugify = require("slugify");
const escapeHtml = require("escape-html");
const { Text } = require("slate");
const path = require("path");
const url = require("url");
require("dotenv").config();

const editorRouter = new express.Router();

const domain = process.env.DOMAIN;
const LOCAL_DOMAIN = process.env.LOCAL_DOMAIN;

//set session verify
const verifyUser = (req, res, next) => {
  if (req.session.isVerified) {
    next();
  } else {
    return res.status(404).json({ message: "Please login first" });
  }
};

function parseRequestBody(req, res, next) {
  const {
    headTitle,
    headKeyword,
    headDescription,
    title,
    manualUrl,
    altText,
    topSorting,
    hidden,
    popularSorting,
    recommendSorting,
  } = req.body;
  if (req.method === "POST") {
    res.headTitle = headTitle !== undefined ? JSON.parse(headTitle) : null;
    res.headKeyword =
      headKeyword !== undefined ? JSON.parse(headKeyword) : null;
    res.headDescription =
      headDescription !== undefined ? JSON.parse(headDescription) : null;
    res.altText = altText !== undefined ? JSON.parse(altText) : null;
    res.title = title !== undefined ? JSON.parse(title) : null;
    res.topSorting = topSorting !== undefined ? JSON.parse(topSorting) : null;
    res.hidden = hidden !== undefined ? JSON.parse(hidden) : false;
    res.popularSorting =
      popularSorting !== undefined ? JSON.parse(popularSorting) : null;
    res.recommendSorting =
      recommendSorting !== undefined ? JSON.parse(recommendSorting) : null;
    res.manualUrl = manualUrl !== undefined ? JSON.parse(manualUrl) : null;
  }
  if (req.method === "PATCH") {
    res.headTitle =
      headTitle === undefined
        ? undefined
        : headTitle === null
        ? null
        : JSON.parse(headTitle);
    res.headKeyword =
      headKeyword === undefined
        ? undefined
        : headKeyword === null
        ? null
        : JSON.parse(headKeyword);
    res.headDescription =
      headDescription === undefined
        ? undefined
        : headDescription === null
        ? null
        : JSON.parse(headDescription);
    res.title =
      title === undefined
        ? undefined
        : title === null
        ? null
        : JSON.parse(title);
    res.manualUrl =
      manualUrl === undefined
        ? undefined
        : manualUrl === null
        ? null
        : JSON.parse(manualUrl);
    res.altText =
      altText === undefined
        ? undefined
        : altText === null
        ? null
        : JSON.parse(altText);
    res.hidden =
      hidden === undefined
        ? undefined
        : hidden === null
        ? false
        : JSON.parse(hidden);
  }
  next();
}

async function getMaxSerialNumber() {
  const maxSerialNumberEditor = await Editor.findOne()
    .sort({ serialNumber: -1 })
    .select("-_id serialNumber");
  return maxSerialNumberEditor ? maxSerialNumberEditor.serialNumber : 0;
}

async function parseCategories(req, res, next) {
  try {
    let categoryJsonString = req.body.categories;
    let categories;
    if (req.method === "POST") {
      categories =
        categoryJsonString !== undefined
          ? JSON.parse(categoryJsonString)
          : null;
    }
    if (req.method === "PATCH") {
      categories =
        categoryJsonString === undefined
          ? undefined
          : categoryJsonString === null
          ? null
          : JSON.parse(categoryJsonString);
    }
    //分類為空值時因JSON stringtify的關係會被轉成字串null
    if (categories === undefined) {
      res.categories = undefined;
      return next();
    } else if (categories[0] === null) {
      const findUncategorized = await Categories.findOne({
        name: "uncategorized",
      }).select("_id name");
      res.categories = findUncategorized;
      return next();
    }

    if (!(categories instanceof Array)) {
      throw new Error("Invalid input: categories must be an array");
    }
    if (categories.length > 1) {
      throw new Error("Invalid input: cannot over one category");
    }

    const categoriesMap = new Map();

    for (const category of categories) {
      if (!categoriesMap.has(category.label)) {
        const existingCategory = await Categories.findOne({
          name: category.label,
        });

        if (existingCategory) {
          categoriesMap.set(category.label, existingCategory._id);
        } else {
          throw new Error("Category name error");
        }
      }
    }
    const categoriesArray = categories.map((category) =>
      categoriesMap.get(category.label)
    );

    res.categories = categoriesArray;
    next();
  } catch (error) {
    res.status(400).send({ message: error.message });
  }
}

async function parseTags(req, res, next) {
  try {
    let tagJsonString = req.body.tags;
    let tags;
    if (req.method === "POST") {
      tags = tagJsonString !== undefined ? JSON.parse(tagJsonString) : null;
    }
    if (req.method === "PATCH") {
      tags =
        tagJsonString === undefined
          ? undefined
          : tagJsonString === null
          ? null
          : JSON.parse(tagJsonString);
    }

    if (tags === null) {
      res.tags = [];
      return next();
    } else if (tags === undefined) {
      res.tags = undefined;
      return next();
    }

    if (!(tags instanceof Array)) {
      throw new Error("Invalid input: tags must be an array");
    }

    const tagsMap = new Map();

    for (const tag of tags) {
      if (tag.__isNew__ === true) {
        const newTag = new Tags({ name: tag.label });
        await newTag.save();
        tagsMap.set(tag.label, newTag._id);

        const newTagName = tag.label;
        const newTagUrl = `${domain}tag_${newTagName}.html`;

        const newTagSitemap = new Sitemap({
          url: newTagUrl,
          originalID: newTag._id,
          type: "tag",
        });
        await newTagSitemap.save();
      } else {
        if (!tagsMap.has(tag.label)) {
          const existingTag = await Tags.findOne({ name: tag.label });

          if (existingTag) {
            tagsMap.set(tag.label, existingTag._id);
          } else {
            throw new Error("Tag name error");
          }
        }
      }
    }

    const tagsArray = tags.map((tag) => tagsMap.get(tag.label));

    res.tags = tagsArray;
    next();
  } catch (error) {
    res.status(400).send({ message: error.message });
    1;
  }
}

function parseHTML(req, res, next) {
  const contentJsonString = req.body.content;
  if (req.method === "PATCH" && !contentJsonString) {
    res.content = undefined;
    next();
    return;
  }
  if (!contentJsonString) {
    res.content = "";
    next();
    return;
  }

  const content = JSON.parse(contentJsonString);
  // console.log(typeof content);

  const serialize = (node) => {
    if (Text.isText(node)) {
      let string = escapeHtml(node.text);
      if (node.bold) {
        string = `<strong>${string}</strong>`;
      }
      return string;
    }

    const children = node.children.map((n) => serialize(n)).join("");

    switch (node.type) {
      case "quote":
        return `<blockquote><p>${children}</p></blockquote>`;
      case "paragraph":
        return `<p>${children}</p>`;
      case "block-quote":
        return `<blockquote>${children}</blockquote>`;
      case "h1":
        return `<h1 style="text-align: ${
          node.align || "initial"
        };"><strong>${children}</strong></h1>`;
      case "h2":
        return `<h2 style="text-align: ${
          node.align || "initial"
        };"><strong>${children}</strong></h2>`;
      case "h3":
        return `<h3 style="text-align: ${
          node.align || "initial"
        };"><strong>${children}</strong></h3>`;
      case "list-item":
        return `<li>${children}</li>`;
      case "numbered-list":
        return `<ol>${children}</ol>`;
      case "bulleted-list":
        return `<ul>${children}</ul>`;
      case "image":
        const srcAttribute = node.url ? `src="${escapeHtml(node.url)}"` : "";
        const altAttribute = node.alt ? `alt="${escapeHtml(node.alt)}"` : "";
        return `<img ${srcAttribute} ${altAttribute}>${children}</img>`;
      case "link":
        return `<a target="_blank" rel="noopener noreferrer" href="${escapeHtml(
          node.url
        )}">${children}</a>`;
      case "button":
        const buttonType = node.buttonType
          ? `type="${escapeHtml(node.buttonType)}"`
          : "";
        return `<button ${buttonType}>${children}</button>`;
      case "badge":
        return `<span class="badge">${children}</span>`;
      default:
        return children;
    }
  };

  const htmlContent = content.map(serialize).join("");

  res.content = content;
  res.htmlContent = htmlContent;
  next();
}

//後台編輯熱門文章用
async function getNewPopularEditors() {
  // 1. 取 popular 不為空值的文章
  const popularEditorsWithSorting = await Editor.find({
    popularSorting: { $exists: true, $ne: null },
    hidden: false,
  }).select(
    "serialNumber title content createdAt popularSorting pageView homeImagePath"
  );
  const sortingEditorIds = popularEditorsWithSorting.map(
    (editor) => editor._id
  );

  // 2. 取前五名自然點閱率的熱門文章
  let popularEditors = await Editor.find({
    pageView: { $ne: null },
    hidden: false,
    _id: { $nin: sortingEditorIds },
  })
    .sort({ pageView: -1 })
    .limit(5)
    .select(
      "serialNumber title content createdAt pageView popularSorting homeImagePath"
    );

  // 使用 map 替換 popularEditors 陣列中的元素
  popularEditors = popularEditors.map((editor, index) => {
    const popularEditor = popularEditorsWithSorting.find(
      (editorWithPageView) => editorWithPageView.popularSorting === index
    );
    return popularEditor || editor;
  });
  // 傳回新的結果
  return popularEditors;
}

async function getNewUnpopularEditors(skip, limit, name) {
  // 1. Get top 5 pageVies data
  const popularEditors = await getNewPopularEditors();
  //2. Get popular editors' _id array
  const popularEditorIds = popularEditors.map((editor) => editor._id);
  // Create the base query
  const baseQuery = {
    _id: { $nin: popularEditorIds },
    hidden: false,
  };

  // Add the title filter if a name is provided
  if (name) {
    baseQuery.title = { $regex: name, $options: "i" };
  }

  // 3. Find all editors that don't have _id in the newPopularEditors array
  const nonPopularEditors = await Editor.find(baseQuery)
    .sort({ pageView: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .select(
      "serialNumber title content createdAt popularSorting pageView homeImagePath"
    );

  // 4. Get the total number of documents that don't have _id in the popularEditorIds array
  const totalDocs = await Editor.countDocuments(baseQuery).exec();
  return {
    editors: nonPopularEditors,
    totalCount: totalDocs,
  };
}
//* _id
async function getEditor(req, res, next) {
  const id = req.params.id;

  let editor;
  try {
    editor = await Editor.findOne({ _id: id })
      .populate({ path: "categories", select: "name" })
      .populate({ path: "tags", select: "name" });
    if (editor == undefined) {
      return res.status(404).json({ message: "can't find editor!" });
    }
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }

  res.editor = editor;
  next();
}

function isPositiveInteger(input) {
  return typeof input === "number" && Number.isInteger(input) && input >= 0;
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

function uploadImage() {
  const storage = multer.memoryStorage();
  const upload = multer({
    storage: storage,
    limits: {
      fileSize: 10000000, //maximim size 10MB
      fieldSize: 10 * 1024 * 1024,
    },
  });
  // return upload.single("homeImagePath");
  return upload.fields([
    { name: "homeImagePath", maxCount: 1 },
    { name: "contentImagePath", maxCount: 1 },
  ]);
}

async function processImage(file, originalFilename) {
  // console.log(file);
  if (!file || !originalFilename) {
    // If there is no file or originalFilename, return null
    return null;
  }
  if (file.mimetype.startsWith("text/")) {
    return file.buffer.toString("utf-8");
  } else if (file.mimetype.startsWith("image/")) {
    // compress image using sharp
    const compressedImage = await sharp(file.buffer)
      .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true, quality: 90 });

    const compressedImage2 = await sharp(file.buffer)
      .resize(450, 300, { fit: "inside", withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true, quality: 70 });

    const extension = originalFilename.substring(
      originalFilename.lastIndexOf(".")
    );
    const filenameWithoutExtension = originalFilename.substring(
      0,
      originalFilename.lastIndexOf(".")
    );
    const newFilename =
      slugify(filenameWithoutExtension, {
        replacement: "-", // replace spaces with replacement character, defaults to `-`
        remove: /[^a-zA-Z0-9]/g, // remove characters that match regex, defaults to `undefined`
        lower: true, // convert to lower case, defaults to `false`
        strict: false, // strip special characters except replacement, defaults to `false`
        trim: true, // trim leading and trailing replacement chars, defaults to `true`
      }) +
      "-" +
      Date.now() +
      extension;

    if (file.fieldname === "homeImagePath") {
      fs.writeFileSync(
        // `C:/Users/user/Desktop/seo-IND-dev/SIT-code/uploadtest/homepage/${newFilename}`,
        `/home/saved_image/homepage/${newFilename}`,
        compressedImage2.data
      );
      return newFilename;
    } else {
      // save compressed image to disk
      fs.writeFileSync(
        // `C:/Users/user/Desktop/seo-IND-dev/SIT-code/uploadtest/content/${newFilename}`,
        `/home/saved_image/content/${newFilename}`,
        compressedImage.data
      );
      fs.writeFileSync(
        // `C:/Users/user/Desktop/seo-IND-dev/SIT-code/uploadtest/homepage/${newFilename}`,
        `/home/saved_image/homepage/${newFilename}`,
        compressedImage2.data
      );
      return newFilename;
    }
  } else {
    return null;
  }
}

function copyFileAndGenerateNewUrl(originalUrl) {
  // 從URL中獲取檔案路徑和檔名
  const parsedUrl = url.parse(originalUrl);
  const originalFilePath = parsedUrl.path;

  // 產生新的檔名和路徑
  const newFileName = `temp-file-${Date.now()}.jpg`; // 使用當前的時間戳生成唯一的新檔名
  const newFilePath = path.join(path.dirname(originalFilePath), newFileName);

  // 複製檔案
  fs.copyFile(originalFilePath, newFilePath, (err) => {
    if (err) throw err;
  });

  // 產生新的URL
  const newUrl = new URL(
    newFilePath,
    `${parsedUrl.protocol}//${parsedUrl.host}`
  ).toString();

  return newUrl;
}

//後台編輯文章處顯示用
editorRouter.get("/editor", parseQuery, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const { pageNumber, limit } = req;
    const { status } = req.query;
    const skip = pageNumber ? (pageNumber - 1) * limit : 0;

    const titlesQuery = req.query.title;
    const categoriesQuery = req.query.category;

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

    if (titlesQuery) {
      const titlesArray = titlesQuery.split(",");
      const titleQueries = titlesArray.map((title) => ({
        title: { $regex: title, $options: "i" },
      }));
      query.$or = titleQueries;
    }

    if (categoriesQuery) {
      const category = await Categories.findOne({ name: categoriesQuery });

      if (!category) {
        res.status(400).send({ message: "Invalid category name." });
        return;
      }
      query.categories = category._id;
    }

    if (startDate && endDate) {
      query.createdAt = { $gte: start, $lt: end };
    } else if (startDate) {
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(start.getDate() + 1);
      query.createdAt = { $gte: start, $lt: end };
    }

    switch (status) {
      case "全部":
        query.status = { $in: ["草稿", "已排程", "已發布"] };
        break;
      case "草稿":
        query.status = "草稿";
        break;
      case "已排程":
        query.status = "已排程";
        break;
      case "隱藏文章":
        query.status = "隱藏文章";
        break;
      case "已發布":
        query.status = "已發布";
        break;
    }

    const editorsQuery = Editor.find(query)
      .populate({ path: "categories", select: "name" })
      .populate({ path: "tags", select: "name" })
      .sort({ createdAt: -1 })
      .select("-content -htmlContent");

    if (limit && limit > 0) {
      editorsQuery.skip(skip).limit(limit);
    }

    let editors = await editorsQuery;

    const totalDocs = await Editor.countDocuments(query).exec();

    const updateEditor = await Promise.all(
      editors.map(async (editor) => {
        const tagIds = editor.tags.map((tag) => tag._id);

        const [categorySitemap, tagSitemaps] = await Promise.all([
          Sitemap.findOne({
            originalID: editor.categories._id,
            type: "category",
          }),
          Sitemap.find({ originalID: { $in: tagIds }, type: "tag" }),
        ]);

        const tagSitemapMap = new Map(
          tagSitemaps.map((sitemap) => [
            sitemap.originalID.toString(),
            sitemap.url,
          ])
        );

        editor = editor.toObject();

        if (categorySitemap) {
          editor.categories = {
            ...editor.categories,
            sitemapUrl: categorySitemap.url,
          };
        }

        editor.tags = editor.tags.map((tag) => ({
          ...tag,
          sitemapUrl: tagSitemapMap.get(tag._id.toString()),
        }));

        const editorSitemap = await Sitemap.findOne({
          originalID: editor._id,
          type: "editor",
        });

        if (editorSitemap) {
          editor.sitemapUrl = editorSitemap.url;
        }

        return editor;
      })
    );

    const result = {
      data: updateEditor,
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

//列出前後台熱門文章
editorRouter.get("/editor/popular", parseQuery, async (req, res) => {
  const { pageNumber, limit } = req;
  const { popular: popularQueryParam } = req.query;
  let popular;

  popular = parseInt(popularQueryParam, 10);

  if (isNaN(popular) || popular < 0 || popular > 1) {
    return res.status(400).send({ message: "Invalid popular parameter" });
  }

  const skip = pageNumber ? (pageNumber - 1) * limit : 0;

  try {
    //不論前後台顯示都是只顯示熱門的五筆
    if (popular === 1) {
      const PopularEditors = await getNewPopularEditors();
      const totalDocs = PopularEditors.length;

      const result = {
        data: PopularEditors,
        totalCount: totalDocs,
      };

      return res.status(200).json(result);
    } else if (popular === 0) {
      const { editors: nonPopularEditors, totalCount: totalDocs } =
        await getNewUnpopularEditors(skip, limit);

      const result = {
        data: nonPopularEditors,
        totalCount: totalDocs,
        totalPages: Math.ceil(totalDocs / limit),
        limit: limit,
        currentPage: pageNumber,
      };

      return res.status(200).json(result);
    }
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

//後台搜尋非熱門文章
editorRouter.get(
  "/editor/searchUnpopular/:name",
  parseQuery,
  async (req, res) => {
    try {
      // 1. Get top 5 pageVies data
      const name = req.params.name;
      const { pageNumber, limit } = req;
      const skip = pageNumber ? (pageNumber - 1) * limit : 0;

      const { editors: nonPopularEditors, totalCount: totalDocs } =
        await getNewUnpopularEditors(skip, limit, name);

      const result = {
        data: nonPopularEditors,
        totalCount: totalDocs,
        totalPages: Math.ceil(totalDocs / limit),
        limit: limit,
        currentPage: pageNumber,
      };

      res.status(200).send(result);
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  }
);

//前後台列出推薦文章
editorRouter.get("/editor/recommend", parseQuery, async (req, res) => {
  const { pageNumber, limit } = req;
  const { recommend: recommendQueryParam } = req.query;
  const { home: homeQueryParam } = req.query;
  // const skip = (pageNumber - 1) * limit;
  let recommend;
  let home;
  let query = {};

  if (recommendQueryParam === undefined) {
    recommend = undefined;
    // Do nothing, just pass the control to the next handler
  } else {
    recommend = parseInt(recommendQueryParam, 10);

    if (isNaN(recommend) || recommend < 0 || recommend > 1) {
      return res.status(400).send({ message: "Invalid recommend parameter" });
    }
  }

  if (homeQueryParam === undefined) {
    home = undefined;
    // Do nothing, just pass the control to the next handler
  } else {
    home = parseInt(homeQueryParam, 10);

    if (isNaN(home) || home !== 1) {
      return res.status(400).send({ message: "Invalid home parameter" });
    }
  }

  switch (recommend) {
    case 1:
      query.recommendSorting = { $ne: null };
      break;
    case 0:
      query.recommendSorting = null;
      break;
  }

  const skip = pageNumber ? (pageNumber - 1) * limit : 0;

  try {
    if (home === 1) {
      if (recommend !== undefined) {
        return res.status(400).json({ message: "Invalid parameter" });
      }
      const allItems = await Editor.aggregate([
        {
          $sort: { createdAt: -1 },
        },
        {
          $match: {
            $and: [
              { hidden: false },
              { recommendSorting: { $ne: null } },
              { recommendSorting: { $exists: true } },
            ],
          },
        },
        {
          $addFields: {
            sortTop: {
              $cond: [
                { $eq: ["$recommendSorting", null] },
                Number.MAX_VALUE,
                "$recommendSorting",
              ],
            },
          },
        },
        {
          $sort: { sortTop: 1 },
        },
        {
          $facet: {
            data: [
              { $skip: skip },
              { $limit: limit },
              {
                $project: {
                  serialNumber: 1,
                  title: 1,
                  content: 1,
                  createdAt: 1,
                  recommendSorting: 1,
                  homeImagePath: 1,
                  hidden: 1,
                },
              },
            ],
            totalCount: [
              {
                $count: "count",
              },
            ],
          },
        },
      ]).exec();

      const [{ data, totalCount }] = allItems;
      const totalDocs = totalCount[0] ? totalCount[0].count : 0;

      const result = {
        data: data,
        totalCount: totalDocs,
        totalPages: Math.ceil(totalDocs / limit),
        limit: limit,
        currentPage: pageNumber,
      };

      res.status(200).json(result);
    } else {
      const items = await Editor.find(query)
        .sort({ recommendSorting: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select(
          "serialNumber title content createdAt recommendSorting homeImagePath"
        )
        .exec();

      const totalDocs = await Editor.countDocuments(query).exec();
      const result = {
        data: items,
        totalCount: totalDocs,
        totalPages: Math.ceil(totalDocs / limit),
        limit: limit,
        currentPage: pageNumber,
      };

      res.status(200).json(result);
    }
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

//後台搜尋非推薦文章
editorRouter.get(
  "/editor/searchUnrecommend/:name",
  parseQuery,
  async (req, res) => {
    try {
      const name = req.params.name;
      const { pageNumber, limit } = req;
      const skip = pageNumber ? (pageNumber - 1) * limit : 0;

      const aggregation = await Editor.aggregate([
        {
          $match: {
            recommendSorting: null,
            title: { $regex: name, $options: "i" },
          },
        },
        {
          $sort: { createdAt: -1 },
        },
        {
          $facet: {
            findUnrecommendEditors: [
              { $skip: skip },
              { $limit: limit },
              {
                $project: {
                  serialNumber: 1,
                  title: 1,
                  content: 1,
                  createdAt: 1,
                  recommendSorting: 1,
                  homeImagePath: 1,
                },
              },
            ],
            totalCount: [{ $count: "count" }],
          },
        },
      ]);

      const findUnrecommendEditors = aggregation[0].findUnrecommendEditors;
      const totalDocs =
        aggregation[0].totalCount.length > 0
          ? aggregation[0].totalCount[0].count
          : 0;

      const result = {
        data: findUnrecommendEditors,
        totalCount: totalDocs,
        totalPages: Math.ceil(totalDocs / limit),
        limit: limit,
        currentPage: pageNumber,
      };

      res.send(result);
    } catch (err) {
      res.status(500).send({ message: err.message });
    }
  }
);

//前後台列出置頂與最新文章
editorRouter.get("/editor/topAndNews", parseQuery, async (req, res) => {
  const { pageNumber, limit } = req;
  const { top: topQueryParam } = req.query;
  const { home: homeQueryParam } = req.query;

  // const skip = (pageNumber - 1) * limit;
  let top;
  let home;
  let query = {};

  if (topQueryParam === undefined) {
    top = undefined;
    // Do nothing, just pass the control to the next handler
  } else {
    top = parseInt(topQueryParam, 10);

    if (isNaN(top) || top < 0 || top > 1) {
      return res.status(400).send({ message: "Invalid top parameter" });
    }
  }

  if (homeQueryParam === undefined) {
    home = undefined;
    // Do nothing, just pass the control to the next handler
  } else {
    home = parseInt(homeQueryParam, 10);

    if (isNaN(home) || home !== 1) {
      return res.status(400).send({ message: "Invalid home parameter" });
    }
  }

  switch (top) {
    case 1:
      query.topSorting = { $ne: null };
      break;
    case 0:
      query.topSorting = null;
      break;
  }

  const skip = pageNumber ? (pageNumber - 1) * limit : 0;

  try {
    if (home === 1) {
      if (top !== undefined) {
        return res.status(400).json({ message: "Invalid parameter" });
      }
      const allItems = await Editor.aggregate([
        {
          $sort: { createdAt: -1 },
        },
        {
          $match: {
            hidden: false,
          },
        },
        {
          $addFields: {
            sortTop: {
              $cond: [
                { $eq: ["$topSorting", null] },
                Number.MAX_VALUE,
                "$topSorting",
              ],
            },
          },
        },
        {
          $sort: { sortTop: 1 },
        },
        {
          $facet: {
            data: [
              { $skip: skip },
              { $limit: limit },
              {
                $project: {
                  serialNumber: 1,
                  title: 1,
                  content: 1,
                  createdAt: 1,
                  topSorting: 1,
                  homeImagePath: 1,
                },
              },
            ],
            totalCount: [
              {
                $count: "count",
              },
            ],
          },
        },
      ]).exec();

      const [{ data, totalCount }] = allItems;
      const totalDocs = totalCount[0] ? totalCount[0].count : 0;

      const result = {
        data: data,
        totalCount: totalDocs,
        totalPages: Math.ceil(totalDocs / limit),
        limit: limit,
        currentPage: pageNumber,
      };

      res.status(200).json(result);
    } else {
      const items = await Editor.find(query)
        .sort({ topSorting: 1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select("serialNumber title content createdAt topSorting homeImagePath")
        .exec();

      const totalDocs = await Editor.countDocuments(query).exec();
      const result = {
        data: items,
        totalCount: totalDocs,
        totalPages: Math.ceil(totalDocs / limit),
        limit: limit,
        currentPage: pageNumber,
      };

      res.status(200).json(result);
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

//後台搜尋非置頂文章
editorRouter.get("/editor/searchUntop/:name", parseQuery, async (req, res) => {
  try {
    const name = req.params.name;
    const { pageNumber, limit } = req;
    const skip = pageNumber ? (pageNumber - 1) * limit : 0;

    const aggregation = await Editor.aggregate([
      {
        $match: {
          topSorting: null,
          title: { $regex: name, $options: "i" },
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $facet: {
          findUntopEditors: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                serialNumber: 1,
                title: 1,
                content: 1,
                createdAt: 1,
                topdSorting: 1,
                homeImagePath: 1,
              },
            },
          ],
          totalCount: [{ $count: "count" }],
        },
      },
    ]);

    const findUntopEditors = aggregation[0].findUntopEditors;
    const totalDocs =
      aggregation[0].totalCount.length > 0
        ? aggregation[0].totalCount[0].count
        : 0;

    const result = {
      data: findUntopEditors,
      totalCount: totalDocs,
      totalPages: Math.ceil(totalDocs / limit),
      limit: limit,
      currentPage: pageNumber,
    };

    res.status(200).send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: err.message });
  }
});

// 後台編輯文章用 *get only title & _id field
editorRouter.get("/editor/title", async (req, res) => {
  try {
    const editor = await Editor.find().select("title updatedAt");
    // .limit(10)
    res.status(200).send(editor);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

editorRouter.get("/editor/relatedArticles/:id", async (req, res) => {
  try {
    const targetArticleId = req.params.id;
    const targetArticle = await Editor.findOne({ _id: targetArticleId }).select(
      "tags"
    );
    const targetTags = targetArticle.tags;

    const relatedArticles = await Editor.find({
      tags: { $in: targetTags },
      _id: { $ne: targetArticleId },
      hidden: false,
    })
      .select("title tags createdAt hidden homeImagePath categories altText")
      .populate({ path: "tags", select: "name" })
      .populate({ path: "categories", select: "name" });
    relatedArticles.forEach((article) => {
      let commonTagsCount = 0;
      article.tags.forEach((tag) => {
        if (targetTags.includes(tag._id.toString())) {
          commonTagsCount++;
        }
      });
      article._doc.commonTagsCount = commonTagsCount;
    });

    // Sort related articles by the number of common tags in descending order
    relatedArticles.sort((a, b) => {
      if (b._doc.commonTagsCount === a._doc.commonTagsCount) {
        return new Date(b.createdAt) - new Date(a.createdAt);
      } else {
        return b._doc.commonTagsCount - a._doc.commonTagsCount;
      }
    });

    const topRelatedArticles = relatedArticles.slice(0, 6);

    const updateRelatedArticles = await Promise.all(
      topRelatedArticles.map(async (editor) => {
        const sitemapUrl = await Sitemap.findOne({
          originalID: editor._id,
          type: "editor",
        });
        if (sitemapUrl) {
          editor = editor.toObject(); // convert mongoose document to plain javascript object
          editor.sitemapUrl = sitemapUrl.url; // add url property
        }
        return editor;
      })
    );

    res.status(200).send({ data: updateRelatedArticles });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

//使用 _id尋找特定文章
editorRouter.get("/editor/:id", getEditor, async (req, res, next) => {
  try {
    const sitemapUrl = await Sitemap.findOne({
      originalID: res.editor._id,
      type: "editor",
    });
    if (sitemapUrl) {
      res.editor = res.editor.toObject(); // convert mongoose document to plain javascript object
      res.editor.sitemapUrl = sitemapUrl.url; // add url property
    }

    if (res.editor.categories) {
      const categoriesSitemap = await Sitemap.findOne({
        originalID: res.editor.categories._id,
        type: "category",
      });
      if (categoriesSitemap) {
        res.editor.categories.sitemapUrl = categoriesSitemap.url;
      }
    }

    if (res.editor.tags) {
      res.editor.tags = await Promise.all(
        res.editor.tags.map(async (tag) => {
          const tagsSitemap = await Sitemap.findOne({
            originalID: tag._id,
            type: "tag",
          });
          if (tagsSitemap) {
            tag = { ...tag, sitemapUrl: tagsSitemap.url };
          }
          return tag;
        })
      );
    }
    res.status(200).send(res.editor);
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

editorRouter.get("/tempEditor/:id", async (req, res, next) => {
  const id = req.params.id;

  let editor;
  try {
    editor = await tempEditor
      .findOne({ _id: id })
      .populate({ path: "categories", select: "name" })
      .populate({ path: "tags", select: "name" });
    if (editor == undefined) {
      return res.status(404).json({ message: "can't find editor!" });
    }
    res.status(200).send(editor);
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
});

editorRouter.get("/domainInfo", async (req, res, next) => {
  try {
    const result = { domain: domain };
    res.status(200).send({ data: result });
  } catch (err) {
    return res.status(500).send({ message: err.message });
  }
});

//新增文章點擊率
editorRouter.patch(
  "/editor/incrementPageview/:id",
  verifyUser,
  getEditor,
  async (req, res) => {
    try {
      const editorId = res.editor._id;

      const article = await Editor.findOneAndUpdate(
        { _id: editorId },
        { $inc: { pageView: 1 } },
        { new: true }
      );

      res.status(200).json({
        message: "Page view count incremented",
        articleTitle: article.title,
      });
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  }
);

//熱門文章復原按鈕
editorRouter.patch(
  "/editor/renewPopularEditors",
  verifyUser,
  async (req, res) => {
    try {
      const result = await Editor.updateMany(
        { popularSorting: { $ne: null } },
        { $set: { popularSorting: null } },
        { multi: true }
      );

      // 回傳更新筆數
      res.status(200).json({
        totalUpdate: result.modifiedCount,
        matchedCount: result.matchedCount,
      });
    } catch (err) {
      // 如果發生錯誤，回傳錯誤訊息
      res.status(400).json({ message: err.message });
    }
  }
);

//推薦文章後台調整確認按鍵
editorRouter.patch(
  "/editor/recommend/bunchModifiedByIds",
  verifyUser,
  async (req, res) => {
    const ids = req.body.ids;
    let updateCount = 0;
    let failedCount = 0;

    try {
      for (const idObject of ids) {
        const id = Object.keys(idObject)[0];
        const recommendSorting = idObject[id];
        const result = await Editor.updateOne(
          { _id: id },
          { $set: { recommendSorting } }
        );
        // if (result.matchedCount === 0) {
        //   res.status(404).send({ error: `找不到對應的id: ${id}` });
        //   return;
        // }
        if (result.matchedCount === 0) {
          failedCount++;
        }

        if (result.modifiedCount > 0) {
          updateCount++;
        }
      }
      res
        .status(200)
        .send({ updateCount: updateCount, failedCount: failedCount });
    } catch (err) {
      res.status(400).send({ message: err.message });
    }
  }
);

//置頂文章後台調整確認按鍵
editorRouter.patch(
  "/editor/top/bunchModifiedByIds",
  verifyUser,
  async (req, res) => {
    const ids = req.body.ids;
    let updateCount = 0;
    let failedCount = 0;

    try {
      for (const idObject of ids) {
        const id = Object.keys(idObject)[0];
        const topSorting = idObject[id];
        const result = await Editor.updateOne(
          { _id: id },
          { $set: { topSorting } }
        );
        // if (result.matchedCount === 0) {
        //   res.status(404).send({ error: `找不到對應的id: ${id}` });
        //   return;
        // }
        if (result.matchedCount === 0) {
          failedCount++;
        }

        if (result.modifiedCount > 0) {
          updateCount++;
        }
      }
      res
        .status(200)
        .send({ updateCount: updateCount, failedCount: failedCount });
    } catch (err) {
      res.status(400).send({ message: err.message });
    }
  }
);

editorRouter.patch("/editor/checkSchedule", async (req, res) => {
  //取得當前時間區間
  let now = new Date();
  let oneHourAgo = new Date();
  oneHourAgo.setTime(oneHourAgo.getTime() - 1 * 60 * 60 * 1000);
  try {
    //取得需要發布的名單
    const listEditor = await Editor.find({
      hidden: true,
      scheduledAt: {
        $exists: true,
        $ne: null,
        $ne: "",
        $gte: oneHourAgo,
        $lte: now,
      },
    }).select("-content -htmlContent");
    let updateCount = 0;
    for (let editor of listEditor) {
      editor.hidden = false;
      await editor.save();
      updateCount++;
    }

    res.status(200).send({ message: `Update ${updateCount} successfully` });
  } catch (err) {
    res.status(400).send({ message: err.message });
  }
});

editorRouter.patch(
  "/editor/:id",
  verifyUser,
  uploadImage(),
  parseRequestBody,
  parseTags,
  parseHTML,
  parseCategories,
  getEditor,
  async (req, res) => {
    const {
      title,
      tags,
      content,
      htmlContent,
      categories,
      headTitle,
      headKeyword,
      headDescription,
      manualUrl,
      altText,
      hidden,
    } = res;

    const contentImagePath =
      req.files.contentImagePath && req.files.contentImagePath[0];
    const homeImagePath = req.files.homeImagePath && req.files.homeImagePath[0];

    const contentFilename = contentImagePath
      ? await processImage(contentImagePath, contentImagePath.originalname)
      : undefined;

    const homeFilename = homeImagePath
      ? await processImage(homeImagePath, homeImagePath.originalname)
      : undefined;

    if (contentFilename !== undefined) {
      if (homeImagePath) {
        res.editor.homeImagePath = homeFilename;
        res.editor.contentImagePath = contentFilename;
      } else {
        res.editor.homeImagePath = `${LOCAL_DOMAIN}home/saved_image/homepage/${contentFilename}`;
        res.editor.contentImagePath = `${LOCAL_DOMAIN}home/saved_image/content/${contentFilename}`;
      }
    }

    if (manualUrl !== undefined) {
      res.editor.manualUrl = manualUrl;
      await Sitemap.updateOne(
        { originalID: res.editor._id, type: "editor" },
        { $set: { url: `${domain}p_${manualUrl}.html` } }
      );
    }
    if (tags !== undefined) res.editor.tags = [...tags];
    if (categories !== undefined) res.editor.categories = categories;
    if (title !== undefined) res.editor.title = title;
    if (content !== undefined) res.editor.content = content;
    if (htmlContent !== undefined) res.editor.htmlContent = htmlContent;
    if (headTitle !== undefined) res.editor.headTitle = headTitle;
    if (headKeyword !== undefined) res.editor.headKeyword = headKeyword;
    if (headDescription !== undefined)
      res.editor.headDescription = headDescription;
    if (altText !== undefined) res.editor.altText = altText;
    if (hidden !== undefined) res.editor.hidden = hidden;

    try {
      await res.editor.save();
      res.status(200).send({ message: "Editor update successfully" });
    } catch (err) {
      res.status(400).send({ message: err.message });
    }
  }
);

editorRouter.post(
  "/editor",
  verifyUser,
  uploadImage(),
  parseRequestBody,
  parseHTML,
  parseTags,
  parseCategories,
  async (req, res) => {
    const {
      title,
      content,
      htmlContent,
      tags,
      categories,
      headTitle,
      headKeyword,
      headDescription,
      manualUrl,
      altText,
      topSorting,
      hidden,
      popularSorting,
      recommendSorting,
    } = res;

    const serialNumber = await getMaxSerialNumber();
    const contentImagePath =
      req.files.contentImagePath && req.files.contentImagePath[0];
    const homeImagePath = req.files.homeImagePath && req.files.homeImagePath[0];
    let message = "";
    if (title === null) {
      message += "title is required\n";
    }
    if (serialNumber === null) {
      message += "serialNumber is required\n";
    }
    if (content === "") {
      message += "content is required\n";
    }
    if (message) {
      res.status(400).send({ message });
    } else {
      try {
        const contentFilename = contentImagePath
          ? await processImage(contentImagePath, contentImagePath.originalname)
          : null;

        const homeFilename = homeImagePath
          ? await processImage(homeImagePath, homeImagePath.originalname)
          : null;

        const editorData = {
          serialNumber: serialNumber + 1,
          title,
          content,
          htmlContent,
          tags,
          categories, //: category ? category._id : null,
          headTitle,
          headKeyword,
          headDescription,
          manualUrl,
          altText,
          topSorting,
          hidden,
          popularSorting,
          recommendSorting,
        };

        if (homeImagePath) {
          editorData.homeImagePath = homeFilename;
          editorData.contentImagePath = contentFilename;
        } else {
          editorData.homeImagePath = `${LOCAL_DOMAIN}home/saved_image/homepage/${contentFilename}`;
          editorData.contentImagePath = `${LOCAL_DOMAIN}home/saved_image/content/${contentFilename}`;
        }

        const newEditor = new Editor(editorData);
        await newEditor.save();

        //save sitemap
        let newEditorSitemap;
        const newEditorOriginalUrl = `${domain}p_${newEditor._id}.html`;
        if (newEditor) {
          let sitemapUrl;
          if (newEditor.manualUrl) {
            sitemapUrl = `${domain}p_${newEditor.manualUrl}.html`;
          } else {
            sitemapUrl = newEditorOriginalUrl;
          }

          newEditorSitemap = new Sitemap({
            url: sitemapUrl,
            originalID: newEditor._id,
            type: "editor",
          });
          await newEditorSitemap.save();
        }
        await Editor.updateOne(
          { _id: newEditor.id },
          { $set: { originalUrl: newEditorOriginalUrl } }
        );

        // console.log(newEditor);
        res.status(201).json(newEditor);
      } catch (err) {
        res.status(400).json({ message: err.message });
      }
    }
  }
);

editorRouter.post(
  "/tempEditor",
  uploadImage(),
  parseRequestBody,
  parseHTML,
  parseTags,
  parseCategories,
  async (req, res) => {
    const {
      title,
      content,
      htmlContent,
      tags,
      categories,
      headTitle,
      headKeyword,
      headDescription,
      manualUrl,
      altText,
      topSorting,
      hidden,
      popularSorting,
      recommendSorting,
    } = res;

    const contentImagePath =
      req.files.contentImagePath && req.files.contentImagePath[0];
    const homeImagePath = req.files.homeImagePath && req.files.homeImagePath[0];
    try {
      const contentFilename = contentImagePath
        ? await processImage(contentImagePath, contentImagePath.originalname)
        : null;

      const homeFilename = homeImagePath
        ? await processImage(homeImagePath, homeImagePath.originalname)
        : null;

      const editorData = {
        title,
        content,
        htmlContent,
        tags,
        categories,
        headTitle,
        headKeyword,
        headDescription,
        manualUrl,
        altText,
        topSorting,
        hidden,
        popularSorting,
        recommendSorting,
      };

      if (homeImagePath) {
        if (contentFilename && contentFilename.startsWith("http")) {
          const newHomeUrl = copyFileAndGenerateNewUrl(homeFilename);
          const newContentUrl = copyFileAndGenerateNewUrl(contentFilename);
          editorData.homeImagePath = newHomeUrl;
          editorData.contentImagePath = newContentUrl;
        } else {
          editorData.homeImagePath = homeFilename;
          editorData.contentImagePath = contentFilename;
        }
      } else {
        editorData.homeImagePath = `${LOCAL_DOMAIN}home/saved_image/homepage/${contentFilename}`;
        editorData.contentImagePath = `${LOCAL_DOMAIN}home/saved_image/content/${contentFilename}`;
      }

      const newTempEditor = new tempEditor(editorData);
      await newTempEditor.save();

      await newTempEditor.updateOne(
        { _id: newTempEditor._id },
        {
          $set: {
            originalUrl: `${domain}preview_${newTempEditor._id}`,
          },
        }
      );

      res.status(201).send({
        data: {
          id: newTempEditor._id,
          originalUrl: newTempEditor.originalUrl,
        },
      });
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  }
);

editorRouter.delete(
  "/editor/bunchDeleteByIds",
  verifyUser,
  async (req, res) => {
    try {
      const ids = req.body.ids;
      // console.log(req.body.ids);
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: "Invalid data." });
      }

      const existingEditors = await Editor.find({ _id: { $in: ids } }).select(
        "_id"
      );

      if (existingEditors.length !== ids.length) {
        return res
          .status(400)
          .json({ message: "Some of the provided Editor IDs do not exist." });
      }

      const deleteSitemap = await Sitemap.deleteMany({
        originalID: { $in: ids },
        type: "editor",
      });
      const deleteEditor = await Editor.deleteMany({ _id: { $in: ids } });
      if (deleteEditor.deletedCount === 0) {
        return res.status(404).json({ message: "No matching editor found" });
      }
      if (deleteEditor.deletedCount !== deleteSitemap.deletedCount) {
        return res.status(404).json({ message: "No matching sitemap found" });
      }

      res.status(200).json({ message: "Delete editor successful!" });
    } catch (e) {
      res.status(500).send({ message: e.message });
    }
  }
);

editorRouter.delete("/tempEditor", async (req, res) => {
  try {
    const deleteList = await tempEditor
      .find()
      .select("-_id contentImagePath homeImagePath");

    for (let doc of deleteList) {
      if (doc.contentImagePath.startsWith("<iframe")) {
        //Do nothing
      } else {
        // Delete contentImagePath
        let contentImagePath = url.parse(doc.contentImagePath).path;
        let homeImagePath = url.parse(doc.homeImagePath).path;

        fs.unlink(contentImagePath, () => {
          console.log(`File ${doc.contentImagePath} was deleted`);
        });

        // Delete homeImagePath
        fs.unlink(homeImagePath, () => {
          console.log(`File ${doc.homeImagePath} was deleted`);
        });
      }
    }
    await tempEditor.deleteMany({});
    res.status(200).send("Files were deleted successfully");
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

module.exports = editorRouter;
