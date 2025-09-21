const router = require("express").Router();
const { body, param, query } = require("express-validator");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

/**
 * Helper: hitung & simpan ulang agregat rating produk
 * NOTE: sesuaikan 'rating' => jika di schema kamu pakai 'avgRating', ganti keynya.
 */
async function recalcProductRating(productId) {
  const agg = await prisma.review.aggregate({
    where: { productId },
    _avg: { star: true },
    _count: true,
  });
  const avg = Number((agg._avg.star || 0).toFixed(2));
  await prisma.product.update({
    where: { id: productId },
    data: { rating: avg, reviewCount: agg._count }, // ganti 'rating' -> 'avgRating' kalau fieldmu bernama avgRating
  });
}

/**
 * @swagger
 * tags:
 *   - name: Reviews
 *     description: Book/write/delete product reviews
 */

/**
 * @swagger
 * /api/reviews:
 *   post:
 *     summary: Upsert my review for a product (must have purchased & COMPLETED)
 *     tags: [Reviews]
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId, star]
 *             properties:
 *               productId: { type: integer, example: 1 }
 *               star: { type: integer, minimum: 1, maximum: 5, example: 5 }
 *               comment: { type: string, example: "Great quality!" }
 *     responses:
 *       200: { description: Created/updated }
 *       400: { description: Validation / business rule failed }
 *       401: { description: Unauthorized }
 */
router.post(
  "/",
  authenticateToken,
  [
    body("productId").isInt({ min: 1 }),
    body("star").isInt({ min: 1, max: 5 }),
    body("comment").optional().isString().isLength({ max: 1000 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { productId, star, comment } = req.body;
      const pid = Number(productId);

      // 1) pastikan produknya ada
      const product = await prisma.product.findUnique({ where: { id: pid } });
      if (!product) return errorResponse(res, "Product not found", 404);

      // 2) business rule: user pernah membeli & item COMPLETED
      const completedItem = await prisma.orderItem.findFirst({
        where: {
          productId: pid,
          status: "COMPLETED",
          order: { userId }, // relasi ke order -> hanya order milik user
        },
        select: { id: true },
      });
      if (!completedItem) {
        return errorResponse(
          res,
          "You can only review products you've completed purchasing",
          400
        );
      }

      // 3) upsert 1-review-per-(user, product)
      // pastikan schema punya @@unique([userId, productId]) di Review
      const existing = await prisma.review.findFirst({
        where: { userId, productId: pid },
        select: { id: true },
      });

      let review;
      if (existing) {
        review = await prisma.review.update({
          where: { id: existing.id },
          data: { star, comment },
        });
      } else {
        review = await prisma.review.create({
          data: { userId, productId: pid, star, comment },
        });
      }

      // 4) update agregat rating produk
      await recalcProductRating(pid);

      return successResponse(res, { review }, "Review saved");
    } catch (e) {
      console.error("Review upsert error:", e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/reviews/product/{productId}:
 *   get:
 *     summary: List reviews for a product
 *     tags: [Reviews]
 *     parameters:
 *       - in: path
 *         name: productId
 *         required: true
 *         schema: { type: integer }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 50 }
 *     responses:
 *       200: { description: OK }
 *       404: { description: Product not found }
 */
router.get(
  "/product/:productId",
  [
    param("productId").isInt({ min: 1 }),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const productId = Number(req.params.productId);
      const { page = 1, limit = 10 } = req.query;

      const product = await prisma.product.findUnique({
        where: { id: productId },
      });
      if (!product) return errorResponse(res, "Product not found", 404);

      const [items, total] = await Promise.all([
        prisma.review.findMany({
          where: { productId },
          orderBy: { createdAt: "desc" },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          include: {
            user: { select: { id: true, name: true, avatarUrl: true } },
          },
        }),
        prisma.review.count({ where: { productId } }),
      ]);

      return successResponse(res, {
        reviews: items,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (e) {
      console.error("List product reviews error:", e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/reviews/{id}:
 *   delete:
 *     summary: Delete my review
 *     tags: [Reviews]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Deleted }
 *       403: { description: Forbidden }
 *       404: { description: Not found }
 */
router.delete(
  "/:id",
  authenticateToken,
  [param("id").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const me = req.user;

      const review = await prisma.review.findUnique({ where: { id } });
      if (!review) return errorResponse(res, "Review not found", 404);
      if (review.userId !== me.id) return errorResponse(res, "Forbidden", 403);

      await prisma.review.delete({ where: { id } });
      await recalcProductRating(review.productId);

      return successResponse(res, { id }, "Review deleted");
    } catch (e) {
      console.error("Delete review error:", e);
      return errorResponse(res);
    }
  }
);

module.exports = router;
