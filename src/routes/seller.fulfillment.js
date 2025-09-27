// src/routes/seller.fulfillment.js
const router = require("express").Router();
const { query, param, body } = require("express-validator");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

/** ===== Helper: dapatkan shop milik user (seller) ===== */
async function getMyShopOr403(userId, res) {
  const shop = await prisma.shop.findUnique({ where: { ownerId: userId } });
  if (!shop) {
    errorResponse(res, "You don't have a shop. Activate seller first.", 403);
    return null;
  }
  return shop;
}

/** ===== Konstanta status ===== */
// Status yang boleh DI-FILTER di GET
const SELLER_FILTER_STATUSES = ["NEW", "CONFIRMED", "SHIPPED", "CANCELLED"];
// Status yang boleh DI-UPDATE oleh seller (PATCH)
const SELLER_UPDATE_STATUSES = ["CONFIRMED", "SHIPPED", "CANCELLED"];

/** ===== Aturan transisi seller =====
 * - NEW -> CONFIRMED
 * - CONFIRMED -> SHIPPED
 * - NEW|CONFIRMED -> CANCELLED
 * - COMPLETED TIDAK bisa di-set seller (hanya buyer).
 */
function canSellerTransit(from, to) {
  if (to === "CANCELLED") return from === "NEW" || from === "CONFIRMED";
  if (from === "NEW" && to === "CONFIRMED") return true;
  if (from === "CONFIRMED" && to === "SHIPPED") return true;
  return false;
}

/**
 * @swagger
 * tags:
 *   - name: Seller Fulfillment
 *     description: Manage order items for your shop (seller-only)
 */

/**
 * @swagger
 * /api/seller/order-items:
 *   get:
 *     summary: List order items for my shop
 *     tags: [Seller Fulfillment]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [NEW, CONFIRMED, SHIPPED, CANCELLED]
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 50 }
 *     responses:
 *       200: { description: OK }
 *       403: { description: Seller shop not found }
 */
router.get(
  "/",
  authenticateToken,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
    query("status").optional().isIn(SELLER_FILTER_STATUSES),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const shop = await getMyShopOr403(req.user.id, res);
      if (!shop) return;

      const { status, page = 1, limit = 10 } = req.query;
      const where = { shopId: shop.id };
      if (status) where.status = status;

      const [rows, total] = await Promise.all([
        prisma.orderItem.findMany({
          where,
          orderBy: { id: "desc" },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          include: {
            product: { select: { id: true, title: true, images: true } },
            order: {
              select: { id: true, code: true, userId: true, createdAt: true },
            },
          },
        }),
        prisma.orderItem.count({ where }),
      ]);

      return successResponse(res, {
        items: rows.map((it) => ({
          id: it.id,
          orderId: it.orderId,
          code: it.order?.code,
          productId: it.productId,
          qty: it.qty,
          priceSnapshot: it.priceSnapshot ?? it.priceSnap, // jaga kompatibilitas
          status: it.status,
          product: it.product
            ? {
                id: it.product.id,
                title: it.product.title,
                images: it.product.images,
              }
            : null,
          createdAt: it.createdAt,
        })),
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
 * /api/seller/order-items/{id}/status:
 *   patch:
 *     summary: Update status of an order item (seller-only)
 *     tags: [Seller Fulfillment]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [CONFIRMED, SHIPPED, CANCELLED]
 *     responses:
 *       200: { description: Updated }
 *       403: { description: Not my shop / invalid transition }
 *       404: { description: Item not found }
 */
router.patch(
  "/:id/status",
  authenticateToken,
  [
    param("id").isInt({ min: 1 }),
    body("status")
      .isIn(SELLER_UPDATE_STATUSES)
      .withMessage("Status must be CONFIRMED, SHIPPED or CANCELLED"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const shop = await getMyShopOr403(req.user.id, res);
      if (!shop) return;

      const id = Number(req.params.id);
      const { status: to } = req.body;

      const item = await prisma.orderItem.findUnique({
        where: { id },
        select: { id: true, shopId: true, status: true },
      });
      if (!item) return errorResponse(res, "Order item not found", 404);
      if (item.shopId !== shop.id) return errorResponse(res, "Forbidden", 403);

      if (!canSellerTransit(item.status, to)) {
        return errorResponse(
          res,
          `Invalid transition for seller: ${item.status} → ${to}`,
          403
        );
      }

      const updated = await prisma.orderItem.update({
        where: { id },
        data: { status: to },
      });

      return successResponse(res, updated, "Status updated");
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

module.exports = router;
