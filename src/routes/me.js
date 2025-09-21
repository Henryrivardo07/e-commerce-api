const router = require("express").Router();
const { body } = require("express-validator");
const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

/**
 * @swagger
 * tags:
 *   - name: Me
 *     description: User profile & personal data
 */

/**
 * @swagger
 * /api/me:
 *   get:
 *     tags: [Me]
 *     summary: Get my profile + quick stats
 *     security: [ { bearerAuth: [] } ]
 *     responses:
 *       200: { description: OK }
 */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatarUrl: true,
        createdAt: true,
        updatedAt: true,
        shop: { select: { id: true, name: true, slug: true, isActive: true } },
      },
    });

    if (!user) return errorResponse(res, "User not found", 404);

    // ringkas statistik (opsional, cepat)
    const [orders, orderItemsCompleted] = await Promise.all([
      prisma.order.count({ where: { userId } }),
      prisma.orderItem.count({
        where: { order: { userId }, status: "COMPLETED" },
      }),
    ]);

    return successResponse(res, {
      ...user,
      stats: {
        totalOrders: orders,
        completedItems: orderItemsCompleted,
        hasShop: !!user.shop,
      },
    });
  } catch (e) {
    console.error(e);
    return errorResponse(res);
  }
});

/**
 * @swagger
 * /api/me:
 *   patch:
 *     tags: [Me]
 *     summary: Update my basic profile
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               phone: { type: string }
 *               avatarUrl: { type: string }
 *     responses:
 *       200: { description: Updated }
 */
router.patch(
  "/",
  authenticateToken,
  [
    body("name").optional().isLength({ min: 2 }),
    body("phone").optional().isString(),
    body("avatarUrl").optional().isString(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { name, phone, avatarUrl } = req.body;

      const updated = await prisma.user.update({
        where: { id: userId },
        data: { name, phone, avatarUrl },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          avatarUrl: true,
          updatedAt: true,
        },
      });

      return successResponse(res, updated, "Profile updated");
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

module.exports = router;
