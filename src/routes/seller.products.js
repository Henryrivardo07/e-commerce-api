// src/routes/seller.products.js
const router = require("express").Router();
const { body, query, param } = require("express-validator");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

// util: ambil shop milik user
async function getMyShop(userId) {
  return prisma.shop.findUnique({ where: { ownerId: userId } });
}

/**
 * @swagger
 * /api/seller/products:
 *   get:
 *     summary: List products of my shop
 *     tags: [Products]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 50 }
 *     responses:
 *       200: { description: OK }
 *       401: { description: Unauthorized }
 */
router.get(
  "/",
  authenticateToken,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
    query("isActive").optional().isBoolean().toBoolean(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const shop = await getMyShop(userId);
      if (!shop) return errorResponse(res, "Seller not activated", 400);

      const { q, isActive, page = 1, limit = 20 } = req.query;
      const where = { shopId: shop.id };
      if (typeof isActive === "boolean") where.isActive = isActive;
      if (q) {
        where.OR = [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ];
      }

      const [items, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: { category: true },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          orderBy: [{ updatedAt: "desc" }],
        }),
        prisma.product.count({ where }),
      ]);

      return successResponse(res, {
        products: items,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/seller/products:
 *   post:
 *     summary: Create a product in my shop
 *     tags: [Products]
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [title, price, stock, categoryId]
 *             properties:
 *               title: { type: string }
 *               description: { type: string, nullable: true }
 *               price: { type: integer, minimum: 0 }
 *               stock: { type: integer, minimum: 0 }
 *               images:
 *                 type: array
 *                 items: { type: string }
 *               categoryId: { type: integer }
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201: { description: Created }
 *       400: { description: Bad Request }
 *       401: { description: Unauthorized }
 */
router.post(
  "/",
  authenticateToken,
  [
    body("title").isLength({ min: 1 }),
    body("price").isInt({ min: 0 }),
    body("stock").isInt({ min: 0 }),
    body("categoryId").isInt({ min: 1 }),
    body("images").optional().isArray(),
    body("images.*").optional().isString(),
    body("isActive").optional().isBoolean(),
    body("description").optional().isString(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const shop = await getMyShop(userId);
      if (!shop) return errorResponse(res, "Seller not activated", 400);

      const {
        title,
        description,
        price,
        stock,
        images = [],
        categoryId,
        isActive = true,
      } = req.body;

      // slug sederhana
      const slug =
        title
          .toString()
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)+/g, "") +
        "-" +
        Date.now();

      const created = await prisma.product.create({
        data: {
          shopId: shop.id,
          categoryId: Number(categoryId),
          title,
          slug,
          description: description ?? null,
          price: Number(price),
          stock: Number(stock),
          images,
          isActive: Boolean(isActive),
        },
      });

      return successResponse(res, created, "Created", 201);
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/seller/products/{id}:
 *   put:
 *     summary: Update my product
 *     tags: [Products]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               description: { type: string, nullable: true }
 *               price: { type: integer, minimum: 0 }
 *               stock: { type: integer, minimum: 0 }
 *               images:
 *                 type: array
 *                 items: { type: string }
 *               categoryId: { type: integer }
 *               isActive: { type: boolean }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 */
router.put(
  "/:id",
  authenticateToken,
  [
    param("id").isInt({ min: 1 }),
    body("title").optional().isLength({ min: 1 }),
    body("price").optional().isInt({ min: 0 }),
    body("stock").optional().isInt({ min: 0 }),
    body("categoryId").optional().isInt({ min: 1 }),
    body("images").optional().isArray(),
    body("images.*").optional().isString(),
    body("isActive").optional().isBoolean(),
    body("description").optional().isString(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const shop = await getMyShop(userId);
      if (!shop) return errorResponse(res, "Seller not activated", 400);

      const id = Number(req.params.id);
      const existing = await prisma.product.findUnique({ where: { id } });
      if (!existing || existing.shopId !== shop.id)
        return errorResponse(res, "Product not found", 404);

      const updated = await prisma.product.update({
        where: { id },
        data: {
          ...(req.body.title && { title: req.body.title }),
          ...(req.body.description !== undefined && {
            description: req.body.description,
          }),
          ...(req.body.price !== undefined && {
            price: Number(req.body.price),
          }),
          ...(req.body.stock !== undefined && {
            stock: Number(req.body.stock),
          }),
          ...(req.body.categoryId !== undefined && {
            categoryId: Number(req.body.categoryId),
          }),
          ...(req.body.images && { images: req.body.images }),
          ...(req.body.isActive !== undefined && {
            isActive: Boolean(req.body.isActive),
          }),
        },
      });

      return successResponse(res, updated, "Updated");
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/seller/products/{id}:
 *   delete:
 *     summary: Delete my product (safe delete)
 *     tags: [Products]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Deleted or deactivated }
 *       404: { description: Not found }
 */
router.delete(
  "/:id",
  authenticateToken,
  [param("id").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const shop = await getMyShop(userId);
      if (!shop) return errorResponse(res, "Seller not activated", 400);

      const id = Number(req.params.id);
      const product = await prisma.product.findUnique({ where: { id } });
      if (!product || product.shopId !== shop.id)
        return errorResponse(res, "Product not found", 404);

      // cek order aktif untuk produk ini di toko ini
      const activeOrderItem = await prisma.orderItem.findFirst({
        where: {
          productId: id,
          shopId: shop.id,
          status: { in: ["NEW", "CONFIRMED", "SHIPPED"] },
        },
        select: { id: true },
      });

      if (activeOrderItem) {
        // safe delete → nonaktifkan saja
        const deactivated = await prisma.product.update({
          where: { id },
          data: { isActive: false },
        });
        return successResponse(
          res,
          deactivated,
          "Product is used by active orders, set to inactive instead"
        );
      }

      const deleted = await prisma.product.delete({ where: { id } });
      return successResponse(res, deleted, "Deleted");
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

module.exports = router;
