// src/routes/categories.js
const router = require("express").Router();
const { query } = require("express-validator");
const { prisma } = require("../config/database");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

/**
 * @swagger
 * /api/categories:
 *   get:
 *     summary: List categories (public)
 *     tags: [Categories]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Search by name
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 100 }
 *     responses:
 *       200:
 *         description: OK
 */
router.get(
  "/",
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 100 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { q, page = 1, limit = 20 } = req.query;

      const where = q
        ? { name: { contains: q, mode: "insensitive" } }
        : undefined;

      const [items, total] = await Promise.all([
        prisma.category.findMany({
          where,
          orderBy: { name: "asc" },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          select: { id: true, name: true, slug: true },
        }),
        prisma.category.count({ where }),
      ]);

      return successResponse(res, {
        categories: items,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages: Math.ceil(total / Number(limit)),
        },
      });
    } catch (e) {
      console.error("list categories error:", e);
      return errorResponse(res);
    }
  }
);

module.exports = router;
