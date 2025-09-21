const express = require("express");
const { body } = require("express-validator");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

const router = express.Router();

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
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, slug]
 *             properties:
 *               name: { type: string, example: "Gadget Hub" }
 *               slug: { type: string, example: "gadget-hub" }
 *               logo: { type: string, format: uri, example: "https://picsum.photos/200" }
 *               address: { type: string, example: "Jl. Melati No.1, Jakarta" }
 *     responses:
 *       201: { description: Shop created }
 *       400: { description: Already a seller / slug taken / validation error }
 */
router.post(
  "/activate",
  authenticateToken,
  [
    body("name").isLength({ min: 2 }).withMessage("name required"),
    body("slug").optional().isString().isLength({ min: 2 }),
    body("logo").optional().isURL().withMessage("logo must be URL"),
    body("address").optional().isString(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { name, slug, logo, address } = req.body;

      // 1) user belum punya shop?
      const existing = await prisma.shop.findFirst({
        where: { ownerId: userId },
      });
      if (existing)
        return errorResponse(res, "You already activated seller mode", 400);

      // 2) slug final & harus unik
      const finalSlug = slug ? slugify(slug) : slugify(name);
      const slugTaken = await prisma.shop.findUnique({
        where: { slug: finalSlug },
      });
      if (slugTaken) return errorResponse(res, "Slug already used", 400);

      // 3) create shop
      const shop = await prisma.shop.create({
        data: {
          ownerId: userId,
          name,
          slug: finalSlug,
          logo: logo || null,
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
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:     { type: string, example: "Gadget Hub Official" }
 *               logo:     { type: string, format: uri, example: "https://picsum.photos/200" }
 *               address:  { type: string, example: "Jl. Melati No.1, Jakarta" }
 *               isActive: { type: boolean, example: true }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: You have no shop yet }
 */
router.patch(
  "/shop",
  authenticateToken,
  [
    body("name").optional().isLength({ min: 2 }),
    body("logo").optional().isURL().withMessage("logo must be a valid URL"),
    body("address").optional().isString(),
    body("isActive").optional().isBoolean(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;

      // pastikan user sudah punya shop
      const shop = await prisma.shop.findFirst({ where: { ownerId: userId } });
      if (!shop) return errorResponse(res, "You have no shop yet", 404);

      // siapkan data update (hanya field yang dikirim)
      const { name, logo, address, isActive } = req.body;
      const data = {};
      if (typeof name !== "undefined") data.name = name;
      if (typeof logo !== "undefined") data.logo = logo || null;
      if (typeof address !== "undefined") data.address = address || null;
      if (typeof isActive !== "undefined") data.isActive = Boolean(isActive);

      const updated = await prisma.shop.update({
        where: { id: shop.id },
        data,
        select: {
          id: true,
          name: true,
          slug: true, // slug tidak otomatis diubah saat rename, biar link tidak rusak
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
