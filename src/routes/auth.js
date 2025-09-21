const router = require("express").Router();
const { body } = require("express-validator");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { prisma } = require("../config/database");
const { successResponse, errorResponse } = require("../utils/response");
const { handleValidationErrors } = require("../middleware/validation");

/**
 * @swagger
 * tags:
 *   - name: Auth
 *     description: Register & login
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               password: { type: string, minLength: 6 }
 *               avatarUrl : {type: string}
 *     responses:
 *       201: { description: Created }
 *       400: { description: Bad Request }
 */
// register
router.post(
  "/register",
  [
    body("name").isLength({ min: 2 }).withMessage("Name is required"),
    body("email").isEmail().withMessage("Valid email required"),
    body("password").isLength({ min: 6 }).withMessage("Min 6 chars password"),
    body("avatarUrl")
      .optional()
      .isURL()
      .withMessage("avatarUrl must be a valid URL"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { name, email, password, avatarUrl } = req.body;
      const exists = await prisma.user.findUnique({ where: { email } });
      if (exists) return errorResponse(res, "Email already used", 400);

      const hash = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: {
          name,
          email,
          password: hash,
          avatarUrl: avatarUrl, // <-- amanin biar null kalau ga dikirim
        },
        select: { id: true, name: true, email: true, avatarUrl: true },
      });

      return successResponse(res, user, "Registered", 201);
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login and get token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/LoginResponse' }
 *       401: { description: Unauthorized }
 */
router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Valid email required"),
    body("password").isLength({ min: 6 }).withMessage("Invalid password"),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return errorResponse(res, "Invalid credentials", 401);

      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return errorResponse(res, "Invalid credentials", 401);

      const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || "7d",
      });

      return successResponse(
        res,
        {
          token,
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            avatarUrl: user.avatarUrl,
          },
        },
        "Logged in"
      );
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

module.exports = router;
