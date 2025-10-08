// src/routes/orders.js
const router = require("express").Router();
const { body, param, query } = require("express-validator");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

/**
 * @swagger
 * tags:
 *   - name: Orders
 *     description: Checkout & buyer orders
 */

// [CHANGED] util: format order response -> parse addressSnap string → object
const buildOrderResponse = (order) => {
  let addressDetail = null;
  const snap = order.addressSnap;

  if (snap && typeof snap === "object") {
    addressDetail = snap;
  } else if (typeof snap === "string") {
    try {
      addressDetail = JSON.parse(snap);
    } catch {
      // fallback legacy (alamat disimpan sebagai string polos)
      addressDetail = { address: snap };
    }
  }

  return {
    id: order.id,
    code: order.code,
    paymentStatus: order.paymentStatus,
    // [KEEP] legacy (string address saja)
    address: addressDetail?.address ?? null,
    // [NEW] semua field alamat + shippingMethod
    addressDetail, // {name, phone, city, postalCode, address, shippingMethod}
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
  };
};

/**
 * @swagger
 * /api/orders/checkout:
 *   post:
 *     summary: Checkout cart -> create Orders per shop (payment mock=PAID)
 *     description: >
 *       - Membuat **satu order per toko** dari isi cart.
 *       - Kirim **selectedItemIds** untuk checkout **sebagian** isi cart (hanya item yang dipilih).
 *       - Menyimpan snapshot alamat lengkap & shipping method di setiap order.
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
 *               address:
 *                 type: object
 *                 required: [name, phone, city, postalCode, address]
 *                 properties:
 *                   name:       { type: string, example: "John Doe" }
 *                   phone:      { type: string, example: "081234567890" }
 *                   city:       { type: string, example: "Jakarta" }
 *                   postalCode: { type: string, example: "11480" }
 *                   address:    { type: string, example: "Jl. Sudirman No. 1" }
 *               shippingMethod:
 *                 type: string
 *                 example: "JNE REG"
 *               selectedItemIds:
 *                 type: array
 *                 description: Daftar **cartItem.id** yang ingin di-checkout. Jika tidak diisi, seluruh isi cart akan di-checkout.
 *                 items: { type: integer, example: 72 }
 *     responses:
 *       200: { description: Orders created (one per shop) }
 *       400: { description: Cart empty / stock invalid / selection invalid }
 *       401: { description: Unauthorized }
 */
router.post(
  "/checkout",
  authenticateToken,
  [
    // alamat & shipping
    body("address.name").isString().trim().isLength({ min: 2 }),
    body("address.phone").isString().trim().isLength({ min: 6 }),
    body("address.city").isString().trim().isLength({ min: 2 }),
    body("address.postalCode").isString().trim().isLength({ min: 3 }),
    body("address.address").isString().trim().isLength({ min: 5 }),
    body("shippingMethod").optional().isString().trim().isLength({ min: 2 }),
    // [NEW] validasi selected item ids
    body("selectedItemIds").optional().isArray(),
    body("selectedItemIds.*").optional().isInt({ min: 1 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    const userId = req.user.id;
    const { address, shippingMethod } = req.body;
    const selectedIds = Array.isArray(req.body.selectedItemIds)
      ? req.body.selectedItemIds.map((x) => Number(x))
      : [];

    try {
      // 1) Ambil cart user
      const cart = await prisma.cart.findUnique({ where: { userId } });
      if (!cart) return errorResponse(res, "Cart is empty", 400);

      // 2) Ambil items (semua atau yang dipilih)
      const itemWhere = {
        cartId: cart.id,
        ...(selectedIds.length && { id: { in: selectedIds } }),
      };

      const items = await prisma.cartItem.findMany({
        where: itemWhere,
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

      // [NEW] validasi pemilihan: kalau user kirim selectedIds tapi ga ketemu semua
      if (selectedIds.length) {
        if (items.length === 0)
          return errorResponse(
            res,
            "No selected items found in your cart",
            400
          );
        // Pastikan semua ID yang dikirim memang milik cart user
        const found = new Set(items.map((it) => it.id));
        const missing = selectedIds.filter((id) => !found.has(id));
        if (missing.length) {
          return errorResponse(
            res,
            "Some selected items are not in your cart",
            400
          );
        }
      }

      if (items.length === 0) return errorResponse(res, "Cart is empty", 400);

      // 3) Validasi stok & availability terkini
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

      // 4) Group by shopId
      const groups = new Map(); // shopId -> items[]
      for (const it of items) {
        const key = it.product.shopId;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
      }

      // Snapshot alamat + shipping
      const addressSnapObj = {
        ...address,
        shippingMethod: shippingMethod ?? null,
      };

      // 5) Transaksi: buat order per toko, update stok, hapus item dari cart (hanya yang diproses)
      const createdOrders = await prisma.$transaction(async (tx) => {
        const results = [];

        for (const [shopId, groupItems] of groups.entries()) {
          const totalAmount = groupItems.reduce(
            (sum, x) => sum + x.qty * x.priceSnapshot,
            0
          );
          const code = `ORD-${Date.now().toString().slice(-8)}-${shopId}`;

          const order = await tx.order.create({
            data: {
              userId,
              code,
              paymentStatus: "PAID", // mock
              totalAmount,
              addressSnap: JSON.stringify(addressSnapObj), // simpan sebagai string JSON
            },
          });

          for (const it of groupItems) {
            await tx.orderItem.create({
              data: {
                orderId: order.id,
                productId: it.productId,
                shopId,
                qty: it.qty,
                status: "NEW",
                titleSnap: it.product.title,
                priceSnap: it.product.price,
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

          results.push(order);
        }

        // [NEW] Hapus dari cart: kalau ada selectedIds → hapus yang dipilih saja; else → kosongkan cart
        if (selectedIds.length) {
          await tx.cartItem.deleteMany({
            where: { cartId: cart.id, id: { in: selectedIds } },
          });
        } else {
          await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        }

        return results;
      });

      // 6) Ambil detail buat response
      const fullOrders = await prisma.order.findMany({
        where: { id: { in: createdOrders.map((o) => o.id) } },
        include: {
          items: {
            include: {
              product: { select: { id: true, title: true, images: true } },
              shop: { select: { id: true, name: true, slug: true } },
            },
          },
        },
        orderBy: { id: "asc" },
      });

      return successResponse(
        res,
        {
          count: fullOrders.length,
          orders: fullOrders.map(buildOrderResponse),
        },
        "Checkout success"
      );
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
 *         schema:
 *           type: string
 *           enum: [PENDING, PAID, FAILED, REFUNDED]
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

/**
 * @swagger
 * /api/orders/{id}/cancel:
 *   patch:
 *     summary: Buyer cancels the whole order (per shop)
 *     description: >
 *       Batalkan **seluruh order** (1 toko). Hanya jika semua item dalam order belum dikirim
 *       (status item: NEW/CONFIRMED/CANCELLED; tidak boleh ada SHIPPED/COMPLETED).
 *       Item yang NEW/CONFIRMED akan diubah ke CANCELLED, stok dikembalikan, dan order di-set REFUNDED (mock).
 *     tags: [Orders]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string, example: "Change of mind" }
 *     responses:
 *       200: { description: Cancelled }
 *       403: { description: Forbidden / invalid state }
 *       404: { description: Order not found }
 */
router.patch(
  "/:id/cancel",
  authenticateToken,
  [
    param("id").isInt({ min: 1 }),
    body("reason").optional().isString().isLength({ max: 500 }),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const orderId = Number(req.params.id);
      const { reason } = req.body;

      // [CHECK] Ambil order + item untuk verifikasi kepemilikan & status
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            select: {
              id: true,
              productId: true,
              qty: true,
              status: true,
            },
          },
        },
      });
      if (!order || order.userId !== userId) {
        return errorResponse(res, "Order not found", 404);
      }

      // [RULE] Tidak boleh ada item yang sudah dikirim/selesai
      const hasShippedOrCompleted = order.items.some(
        (it) => it.status === "SHIPPED" || it.status === "COMPLETED"
      );
      if (hasShippedOrCompleted) {
        return errorResponse(
          res,
          "Some items have been shipped or completed. This order can no longer be cancelled.",
          403
        );
      }

      // Item yang akan di-cancel (NEW/CONFIRMED). Yang sudah CANCELLED diabaikan.
      const cancellable = order.items.filter(
        (it) => it.status === "NEW" || it.status === "CONFIRMED"
      );
      if (cancellable.length === 0) {
        // semua item mungkin sudah CANCELLED sebelumnya
        // tetap set order REFUNDED agar konsisten
        await prisma.order.update({
          where: { id: orderId },
          data: { paymentStatus: "REFUNDED" },
        });
        return successResponse(
          res,
          { orderId, cancelledItems: 0 },
          "Order already cancelled"
        );
      }

      // [TX] batalkan item, kembalikan stok, set order REFUNDED
      const result = await prisma.$transaction(async (tx) => {
        // 1) Batalkan semua item yang masih NEW/CONFIRMED
        const updatedItems = [];
        for (const it of cancellable) {
          const upd = await tx.orderItem.update({
            where: { id: it.id },
            data: {
              status: "CANCELLED",
              // Kalau punya kolom alasan, isi di sini:
              // cancelReason: reason ?? null,
            },
          });
          updatedItems.push(upd);

          // 2) Kembalikan stok & koreksi soldCount
          await tx.product.update({
            where: { id: it.productId },
            data: {
              stock: { increment: it.qty },
              soldCount: { decrement: it.qty },
            },
          });
        }

        // 3) Set order REFUNDED (mock). Bisa juga hitung ulang totalAmount jika mau.
        const updOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            paymentStatus: "REFUNDED",
            // Optional: jika kamu ingin totalAmount ikut 0 saat semuanya cancel:
            // totalAmount: 0,
          },
        });

        return { updatedItems, updOrder };
      });

      return successResponse(
        res,
        {
          orderId,
          paymentStatus: "REFUNDED",
          cancelledItems: result.updatedItems.length,
        },
        "Order cancelled"
      );
    } catch (e) {
      console.error("Buyer cancel order error:", e);
      return errorResponse(res);
    }
  }
);

module.exports = router;
