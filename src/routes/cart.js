// src/routes/cart.js
const router = require("express").Router();
const { body, param } = require("express-validator");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

// helper: ambil / buat cart milik user
async function getOrCreateCart(userId) {
  let cart = await prisma.cart.findUnique({ where: { userId } });
  if (!cart) cart = await prisma.cart.create({ data: { userId } });
  return cart;
}

// ---- GET /api/cart ---------------------------------------------------------
/**
 * @swagger
 * /api/cart:
 *   get:
 *     summary: Get my cart (items + subtotal + grandTotal)
 *     tags: [Cart]
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200: { description: OK }
 *       401: { description: Unauthorized }
 */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const cart = await getOrCreateCart(userId);

    const items = await prisma.cartItem.findMany({
      where: { cartId: cart.id },
      include: {
        product: {
          select: {
            id: true,
            title: true,
            price: true,
            images: true,
            isActive: true,
            stock: true,
          },
        },
      },
      orderBy: { id: "desc" },
    });

    const mapped = items.map((it) => ({
      id: it.id,
      productId: it.productId,
      qty: it.qty,
      priceSnapshot: it.priceSnapshot,
      subtotal: it.qty * it.priceSnapshot,
      product: it.product,
    }));
    const grandTotal = mapped.reduce((s, x) => s + x.subtotal, 0);

    return successResponse(res, { cartId: cart.id, items: mapped, grandTotal });
  } catch (e) {
    console.error(e);
    return errorResponse(res);
  }
});

// ---- POST /api/cart/items ---------------------------------------------------
/**
 * @swagger
 * /api/cart/items:
 *   post:
 *     summary: Add item to cart (merge qty if already exists)
 *     tags: [Cart]
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [productId, qty]
 *             properties:
 *               productId: { type: integer }
 *               qty: { type: integer, minimum: 1, default: 1 }
 *     responses:
 *       200: { description: Added/merged }
 *       400: { description: Bad Request }
 *       401: { description: Unauthorized }
 */
router.post(
  "/items",
  authenticateToken,
  [body("productId").isInt({ min: 1 }), body("qty").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { productId, qty } = req.body;

      const product = await prisma.product.findUnique({
        where: { id: Number(productId) },
        select: { id: true, price: true, stock: true, isActive: true },
      });
      if (!product || !product.isActive)
        return errorResponse(res, "Product not available", 400);

      // ensure cart exists
      const cart = await prisma.cart.upsert({
        where: { userId },
        update: {},
        create: { userId },
      });

      const existing = await prisma.cartItem.findFirst({
        where: { cartId: cart.id, productId: Number(productId) },
      });

      const desiredQty = (existing?.qty || 0) + Number(qty);
      if (desiredQty > product.stock) {
        return errorResponse(res, `Only ${product.stock} left in stock`, 400);
      }

      let item;
      if (existing) {
        item = await prisma.cartItem.update({
          where: { id: existing.id },
          data: { qty: desiredQty, priceSnapshot: product.price },
        });
      } else {
        item = await prisma.cartItem.create({
          data: {
            cartId: cart.id,
            productId: Number(productId),
            qty: Number(qty),
            priceSnapshot: product.price,
          },
        });
      }

      return successResponse(res, item, "Added");
    } catch (e) {
      console.error("Add cart error:", e);
      return errorResponse(res, "Failed to add to cart");
    }
  }
);

// ---- PATCH /api/cart/items/:itemId -----------------------------------------
/**
 * @swagger
 * /api/cart/items/{itemId}:
 *   patch:
 *     summary: Update item qty in my cart
 *     tags: [Cart]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [qty]
 *             properties:
 *               qty: { type: integer, minimum: 1 }
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 */
router.patch(
  "/items/:itemId",
  authenticateToken,
  [param("itemId").isInt({ min: 1 }), body("qty").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const itemId = Number(req.params.itemId);
      const { qty } = req.body;

      // pastikan item milik cart user
      const item = await prisma.cartItem.findUnique({
        where: { id: itemId },
        include: {
          cart: true,
          product: { select: { stock: true, isActive: true, price: true } },
        },
      });
      if (!item || item.cart.userId !== userId)
        return errorResponse(res, "Not found", 404);

      if (!item.product?.isActive)
        return errorResponse(res, "Product not available", 400);

      if (Number(qty) > item.product.stock) {
        return errorResponse(
          res,
          `Only ${item.product.stock} left in stock`,
          400
        );
      }

      const updated = await prisma.cartItem.update({
        where: { id: itemId },
        data: { qty: Number(qty), priceSnapshot: item.product.price },
      });

      return successResponse(res, updated, "Updated");
    } catch (e) {
      console.error("Update cart qty error:", e);
      return errorResponse(res, "Failed to update cart item");
    }
  }
);

// ---- DELETE /api/cart/items/:itemId ----------------------------------------
/**
 * @swagger
 * /api/cart/items/{itemId}:
 *   delete:
 *     summary: Remove an item from my cart
 *     tags: [Cart]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: itemId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Deleted }
 *       404: { description: Not found }
 */
router.delete(
  "/items/:itemId",
  authenticateToken,
  [param("itemId").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const itemId = Number(req.params.itemId);

      const cart = await getOrCreateCart(userId);
      const item = await prisma.cartItem.findUnique({ where: { id: itemId } });
      if (!item || item.cartId !== cart.id)
        return errorResponse(res, "Item not found", 404);

      const deleted = await prisma.cartItem.delete({ where: { id: itemId } });
      return successResponse(res, deleted, "Deleted");
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

// ---- DELETE /api/cart (clear cart) -----------------------------------------
/**
 * @swagger
 * /api/cart:
 *   delete:
 *     summary: Clear my cart
 *     tags: [Cart]
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200: { description: Emptied }
 */
router.delete("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const cart = await getOrCreateCart(userId);
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    return successResponse(res, { cartId: cart.id }, "Emptied");
  } catch (e) {
    console.error(e);
    return errorResponse(res);
  }
});

module.exports = router;
