// src/routes/seller.js
const express = require("express");
const { body } = require("express-validator");
const multer = require("multer");
const streamifier = require("streamifier");
const cloudinary = require("cloudinary").v2;

const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

const router = express.Router();

/** ===== Cloudinary setup ===== */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME, // required
  api_key: process.env.CLOUDINARY_API_KEY, // required
  api_secret: process.env.CLOUDINARY_API_SECRET, // required
});

/** ===== Multer (memory) ===== */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "image/png" ||
      file.mimetype === "image/jpeg" ||
      file.mimetype === "image/webp";
    if (!ok) return cb(new Error("Only PNG/JPG/WEBP allowed"));
    cb(null, true);
  },
});

/** ===== Helpers ===== */
function uploadBufferToCloudinary(buffer, folder = "ecommerce/shops") {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    streamifier.createReadStream(buffer).pipe(stream);
  });
}

const slugify = (s) =>
  s
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

/**
 * @swagger
 * tags:
 *   - name: Seller
 *     description: Seller activation & shop profile
 */

/**
 * @swagger
 * /api/seller/activate:
 *   post:
 *     summary: Activate seller mode (create a shop for current user)
 *     tags: [Seller]
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:    { type: string, example: "Gadget Hub" }
 *               slug:    { type: string, example: "gadget-hub" }
 *               logo:    { type: string, format: binary, description: "PNG/JPG/WEBP max 5MB" }
 *               address: { type: string, example: "Jl. Melati No.1, Jakarta" }
 *     responses:
 *       201: { description: Shop created }
 *       400: { description: Already a seller / slug taken / validation error }
 */
router.post(
  "/activate",
  authenticateToken,
  upload.single("logo"),
  [body("name").isLength({ min: 2 }).withMessage("name required")],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { name, slug, address } = req.body;

      // 1) sudah punya shop?
      const existing = await prisma.shop.findFirst({
        where: { ownerId: userId },
      });
      if (existing)
        return errorResponse(res, "You already activated seller mode", 400);

      // 2) slug unik
      const finalSlug = slug ? slugify(slug) : slugify(name);
      const slugTaken = await prisma.shop.findUnique({
        where: { slug: finalSlug },
      });
      if (slugTaken) return errorResponse(res, "Slug already used", 400);

      // 3) upload logo kalau ada
      let logoUrl = null;
      if (req.file?.buffer) {
        try {
          const result = await uploadBufferToCloudinary(req.file.buffer);
          logoUrl = result.secure_url;
        } catch (err) {
          console.error("Cloudinary upload error:", err);
          return errorResponse(res, "Failed to upload logo", 400);
        }
      }

      // 4) create shop
      const shop = await prisma.shop.create({
        data: {
          ownerId: userId,
          name,
          slug: finalSlug,
          logo: logoUrl,
          address: address || null,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          slug: true,
          logo: true,
          address: true,
          isActive: true,
          createdAt: true,
        },
      });

      return successResponse(res, shop, "Shop created", 201);
    } catch (e) {
      console.error("activate seller error:", e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/seller/shop:
 *   get:
 *     summary: Get my shop profile
 *     tags: [Seller]
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200: { description: OK }
 *       404: { description: Not a seller yet }
 */
router.get("/shop", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const shop = await prisma.shop.findFirst({
      where: { ownerId: userId },
      select: {
        id: true,
        name: true,
        slug: true,
        logo: true,
        address: true,
        isActive: true,
        createdAt: true,
        _count: { select: { products: true, orderItems: true } },
      },
    });
    if (!shop) return errorResponse(res, "You have no shop yet", 404);

    return successResponse(res, shop);
  } catch (e) {
    console.error("get shop error:", e);
    return errorResponse(res);
  }
});

/**
 * @swagger
 * /api/seller/shop:
 *   patch:
 *     summary: Update my shop profile
 *     tags: [Seller]
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name:     { type: string, example: "Gadget Hub Official" }
 *               logo:     { type: string, format: binary, description: "PNG/JPG/WEBP max 5MB" }
 *               address:  { type: string, example: "Jl. Melati No.1, Jakarta" }
 *               isActive: { type: boolean, example: true }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: You have no shop yet }
 */
router.patch(
  "/shop",
  authenticateToken,
  upload.single("logo"),
  async (req, res) => {
    try {
      const userId = req.user.id;

      // pastikan sudah punya shop
      const shop = await prisma.shop.findFirst({ where: { ownerId: userId } });
      if (!shop) return errorResponse(res, "You have no shop yet", 404);

      const { name, address, isActive } = req.body;
      const data = {};

      if (typeof name !== "undefined") data.name = name;
      if (typeof address !== "undefined") data.address = address || null;
      if (typeof isActive !== "undefined") data.isActive = Boolean(isActive);

      // upload logo jika ada
      if (req.file?.buffer) {
        try {
          const result = await uploadBufferToCloudinary(req.file.buffer);
          data.logo = result.secure_url;
        } catch (err) {
          console.error("Cloudinary upload error:", err);
          return errorResponse(res, "Failed to upload logo", 400);
        }
      }

      const updated = await prisma.shop.update({
        where: { id: shop.id },
        data,
        select: {
          id: true,
          name: true,
          slug: true,
          logo: true,
          address: true,
          isActive: true,
          updatedAt: true,
        },
      });

      return successResponse(res, updated, "Shop updated");
    } catch (e) {
      console.error("update shop error:", e);
      return errorResponse(res);
    }
  }
);

module.exports = router;
