const router = require("express").Router();
const { query, param } = require("express-validator");
const { prisma } = require("../config/database");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: List products (public catalog)
 *     tags: [Products]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: categoryId
 *         schema: { type: integer }
 *       - in: query
 *         name: minPrice
 *         schema: { type: integer }
 *       - in: query
 *         name: maxPrice
 *         schema: { type: integer }
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [price, rating, newest, popular]
 *           default: newest
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: OK
 */
router.get(
  "/",
  [
    query("categoryId").optional().isInt({ min: 1 }),
    query("minPrice").optional().isInt({ min: 0 }),
    query("maxPrice").optional().isInt({ min: 0 }),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
    query("order").optional().isIn(["asc", "desc"]),
    query("sort").optional().isIn(["price", "rating", "newest", "popular"]),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const {
        q,
        categoryId,
        minPrice,
        maxPrice,
        sort = "newest",
        order = "desc",
        page = 1,
        limit = 20,
      } = req.query;

      const where = {
        isActive: true,
        ...(q && {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
          ],
        }),
        ...(categoryId && { categoryId: Number(categoryId) }),
        ...((minPrice || maxPrice) && {
          price: {
            ...(minPrice && { gte: Number(minPrice) }),
            ...(maxPrice && { lte: Number(maxPrice) }),
          },
        }),
      };

      const orderMap = {
        price: { price: order },
        rating: { rating: order },
        newest: { createdAt: order },
        popular: { soldCount: order },
      };
      const orderBy = orderMap[sort] || { createdAt: "desc" };

      const [items, total] = await Promise.all([
        prisma.product.findMany({
          where,
          orderBy,
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          select: {
            id: true,
            title: true,
            slug: true,
            price: true,
            stock: true,
            images: true,
            rating: true,
            reviewCount: true,
            soldCount: true,
            category: { select: { id: true, name: true, slug: true } },
            shop: { select: { id: true, name: true, slug: true } },
          },
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
      console.error("list products error:", e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/products/{id}:
 *   get:
 *     summary: Get product detail (public)
 *     tags: [Catalog]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Not found }
 */
router.get(
  "/:id",
  [param("id").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const product = await prisma.product.findUnique({
        where: { id },
        include: {
          category: { select: { id: true, name: true, slug: true } },
          shop: { select: { id: true, name: true, slug: true } },
          reviews: {
            take: 10,
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              star: true,
              comment: true,
              createdAt: true,
              user: { select: { id: true, name: true, avatarUrl: true } },
            },
          },
        },
      });

      if (!product || !product.isActive) {
        return errorResponse(res, "Product not found", 404);
      }

      return successResponse(res, product);
    } catch (e) {
      console.error("product detail error:", e);
      return errorResponse(res);
    }
  }
);

module.exports = router;
