// src/routes/checkout.js
const router = require("express").Router();
const { body } = require("express-validator");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

// util: format order response ringkas
const buildOrderResponse = (order) => ({
  id: order.id,
  code: order.code,
  paymentStatus: order.paymentStatus,
  address: order.address,
  totalAmount: order.totalAmount,
  createdAt: order.createdAt,
  items: order.items?.map((it) => ({
    id: it.id,
    productId: it.productId,
    shopId: it.shopId,
    qty: it.qty,
    priceSnapshot: it.priceSnapshot,
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
 * /api/checkout:
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
  "/",
  authenticateToken,
  [body("address").isString().trim().isLength({ min: 5 })],
  handleValidationErrors,
  async (req, res) => {
    const userId = req.user.id;
    const { address } = req.body;

    try {
      // cek cart
      const cart = await prisma.cart.findUnique({ where: { userId } });
      if (!cart) return errorResponse(res, "Cart is empty", 400);

      const items = await prisma.cartItem.findMany({
        where: { cartId: cart.id },
        include: {
          product: {
            select: {
              id: true,
              title: true,
              stock: true,
              isActive: true,
              shopId: true,
            },
          },
        },
      });
      if (items.length === 0) return errorResponse(res, "Cart is empty", 400);

      // validasi stok
      for (const it of items) {
        if (!it.product || !it.product.isActive)
          return errorResponse(
            res,
            `Product ${it.productId} not available`,
            400
          );
        if (it.product.stock < it.qty)
          return errorResponse(
            res,
            `Insufficient stock for product ${it.productId}`,
            400
          );
      }

      const totalAmount = items.reduce(
        (sum, x) => sum + x.qty * x.priceSnapshot,
        0
      );
      const code = `ORD-${Date.now().toString().slice(-8)}`;

      const created = await prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: { userId, code, address, paymentStatus: "PAID", totalAmount },
        });

        for (const it of items) {
          await tx.orderItem.create({
            data: {
              orderId: order.id,
              productId: it.productId,
              shopId: it.product.shopId,
              qty: it.qty,
              priceSnapshot: it.priceSnapshot,
              status: "NEW",
            },
          });

          await tx.product.update({
            where: { id: it.productId },
            data: {
              stock: { decrement: it.qty },
              soldCount: { increment: it.qty },
            },
          });
        }

        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        return order;
      });

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

module.exports = router;
