// src/routes/orders.js
const router = require("express").Router();
const { body, param, query } = require("express-validator");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

// util: format order response ringkas
const buildOrderResponse = (order) => ({
  id: order.id,
  code: order.code,
  paymentStatus: order.paymentStatus,
  address: order.addressSnap?.address ?? order.addressSnap ?? null, // Json atau String
  totalAmount: order.totalAmount,
  createdAt: order.createdAt,
  items: order.items?.map((it) => ({
    id: it.id,
    productId: it.productId,
    shopId: it.shopId,
    qty: it.qty,
    priceSnapshot: it.priceSnap,
    status: it.status,
    product: it.product
      ? {
          id: it.product.id,
          title: it.product.title,
          images: it.product.images,
        }
      : undefined,
    shop: it.shop
      ? { id: it.shop.id, name: it.shop.name, slug: it.shop.slug }
      : undefined,
  })),
});

/**
 * @swagger
 * /api/orders/checkout:
 *   post:
 *     summary: Checkout cart -> create Order & OrderItems (payment mock=PAID)
 *     tags: [Orders]
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [address]
 *             properties:
 *               address: { type: string, example: "Jl. Sudirman No. 1, Jakarta" }
 *     responses:
 *       200: { description: Order created }
 *       400: { description: Cart empty / stock invalid }
 *       401: { description: Unauthorized }
 */
router.post(
  "/checkout",
  authenticateToken,
  [body("address").isString().trim().isLength({ min: 5 })],
  handleValidationErrors,
  async (req, res) => {
    const userId = req.user.id;
    const { address } = req.body;

    try {
      // 1) Ambil cart + item beserta product & shop
      const cart = await prisma.cart.findUnique({ where: { userId } });
      if (!cart) return errorResponse(res, "Cart is empty", 400);

      const items = await prisma.cartItem.findMany({
        where: { cartId: cart.id },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              images: true,
              price: true,
              stock: true,
              isActive: true,
              shopId: true,
            },
          },
        },
      });

      if (items.length === 0) return errorResponse(res, "Cart is empty", 400);

      // 2) Validasi stok & ketersediaan terkini
      for (const it of items) {
        if (!it.product || !it.product.isActive) {
          return errorResponse(
            res,
            `Product ${it.productId} not available`,
            400
          );
        }
        if (it.product.stock < it.qty) {
          return errorResponse(
            res,
            `Insufficient stock for product ${it.productId}`,
            400
          );
        }
      }

      // 3) Hitung total berdasarkan priceSnapshot (sesuai kontrak cart)
      const totalAmount = items.reduce(
        (sum, x) => sum + x.qty * x.priceSnapshot,
        0
      );

      // Helper kode order sederhana (YYYYMMDD-xxxxx)
      const code = `ORD-${Date.now().toString().slice(-8)}`;

      // 4) Transaksi: buat order + orderItems, update stok, kosongkan cart
      const created = await prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            userId,
            code,
            paymentStatus: "PAID", // mock payment
            totalAmount,
            addressSnap: String(address), // <- STRING biasa
          },
        });

        // Buat item per cartItem
        for (const it of items) {
          await tx.orderItem.create({
            data: {
              orderId: order.id,
              productId: it.productId,
              shopId: it.product.shopId,
              qty: it.qty,
              status: "NEW",
              titleSnap: it.product.title,
              // imageSnap: it.product.images?.[0] ?? null,
              priceSnap: it.product.price,
            },
          });

          // Decrement stok real-time
          await tx.product.update({
            where: { id: it.productId },
            data: {
              stock: { decrement: it.qty },
              soldCount: { increment: it.qty },
            },
          });
        }

        // Kosongkan cart
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

        return order;
      });

      // Fetch detail order buat response
      const full = await prisma.order.findUnique({
        where: { id: created.id },
        include: {
          items: {
            include: {
              product: { select: { id: true, title: true, images: true } },
              shop: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      });

      return successResponse(res, buildOrderResponse(full), "Checkout success");
    } catch (e) {
      console.error("Checkout error:", e);
      return errorResponse(res, "Checkout failed");
    }
  }
);

/**
 * @swagger
 * /api/orders/my:
 *   get:
 *     summary: List my orders
 *     tags: [Orders]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 50 }
 *       - in: query
 *         name: paymentStatus
 *         schema: { type: string, enum: [PENDING, PAID, FAILED, REFUNDED] }
 *     responses:
 *       200: { description: OK }
 */
router.get(
  "/my",
  authenticateToken,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
    query("paymentStatus")
      .optional()
      .isIn(["PENDING", "PAID", "FAILED", "REFUNDED"]),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10, paymentStatus } = req.query;

      const where = { userId };
      if (paymentStatus) where.paymentStatus = paymentStatus;

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          include: {
            items: {
              include: {
                product: { select: { id: true, title: true, images: true } },
                shop: { select: { id: true, name: true, slug: true } },
              },
            },
          },
        }),
        prisma.order.count({ where }),
      ]);

      return successResponse(res, {
        orders: orders.map(buildOrderResponse),
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
 * /api/orders/{id}:
 *   get:
 *     summary: Get my order detail
 *     tags: [Orders]
 *     security: [ { bearerAuth: [] } ]
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
  authenticateToken,
  [param("id").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const id = Number(req.params.id);

      const order = await prisma.order.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              product: { select: { id: true, title: true, images: true } },
              shop: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      });

      if (!order || order.userId !== userId)
        return errorResponse(res, "Order not found", 404);

      return successResponse(res, buildOrderResponse(order));
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/orders/items/{id}/complete:
 *   patch:
 *     summary: Buyer confirms receipt (mark order item as COMPLETED)
 *     description: Hanya pembeli (pemilik order) yang boleh konfirmasi. Hanya bisa dari status **SHIPPED** → **COMPLETED**.
 *     tags: [Orders]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Updated }
 *       403: { description: Forbidden / invalid transition }
 *       404: { description: Order item not found }
 */
router.patch(
  "/items/:id/complete",
  authenticateToken,
  [param("id").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const id = Number(req.params.id);

      // ambil item + order userId untuk verifikasi kepemilikan
      const item = await prisma.orderItem.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          orderId: true,
          order: { select: { id: true, userId: true } },
        },
      });

      if (!item) return errorResponse(res, "Order item not found", 404);
      if (!item.order || item.order.userId !== userId) {
        return errorResponse(res, "Forbidden", 403);
      }

      // aturan buyer: hanya dari SHIPPED -> COMPLETED
      if (item.status !== "SHIPPED") {
        return errorResponse(
          res,
          `Invalid transition for buyer: ${item.status} → COMPLETED`,
          403
        );
      }

      const updated = await prisma.orderItem.update({
        where: { id },
        data: { status: "COMPLETED" },
      });

      return successResponse(res, updated, "Order item completed");
    } catch (e) {
      console.error("Buyer complete error:", e);
      return errorResponse(res);
    }
  }
);

module.exports = router;
