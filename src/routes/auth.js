const router = require("express").Router();
const { body } = require("express-validator");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const { cloudinary } = require("../config/cloudinary");
const { prisma } = require("../config/database");
const { successResponse, errorResponse } = require("../utils/response");
const { handleValidationErrors } = require("../middleware/validation");

// Multer setup (memory storage, limit 5MB, hanya image)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpe?g|png|webp)$/i.test(file.mimetype);
    cb(ok ? null : new Error("Only JPG/PNG/WEBP allowed"), ok);
  },
});

// Helper upload Cloudinary
function uploadToCloudinary(buffer, opts = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "ecommerce/avatars",
        resource_type: "image",
        ...opts,
      },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, example: "John Doe" }
 *               email: { type: string, example: "john@email.com" }
 *               password: { type: string, minLength: 6, example: "secret123" }
 *               avatar:
 *                 type: string
 *                 format: binary
 *                 description: Upload avatar image (PNG/JPG/WEBP max 5MB)
 *               avatarUrl:
 *                 type: string
 *                 description: Alternative avatar URL if not uploading file
 *     responses:
 *       201: { description: Created }
 *       400: { description: Bad Request }
 */
router.post(
  "/register",
  upload.single("avatar"),
  [
    body("name").isLength({ min: 2 }).withMessage("Name is required"),
    body("email").isEmail().withMessage("Valid email required"),
    body("password").isLength({ min: 6 }).withMessage("Min 6 chars password"),
    // ⬇️ ini yang diubah
    body("avatarUrl")
      .optional({ nullable: true, checkFalsy: true })
      .isURL()
      .withMessage("avatarUrl must be a valid URL")
      .bail()
      .customSanitizer((v) => (v && String(v).trim().length ? v : undefined)),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const { name, email, password, avatarUrl } = req.body;
      const exists = await prisma.user.findUnique({ where: { email } });
      if (exists) return errorResponse(res, "Email already used", 400);

      const hash = await bcrypt.hash(password, 10);

      // tentukan avatar final
      let finalAvatar = avatarUrl || null;

      if (req.file?.buffer) {
        const result = await uploadToCloudinary(req.file.buffer, {
          public_id: `u_${Date.now()}`,
          transformation: [
            { width: 512, height: 512, crop: "fill", gravity: "auto" },
            { quality: "auto", fetch_format: "auto" },
          ],
        });
        finalAvatar = result.secure_url;
      }

      const user = await prisma.user.create({
        data: { name, email, password: hash, avatarUrl: finalAvatar },
        select: { id: true, name: true, email: true, avatarUrl: true },
      });

      return successResponse(res, user, "Registered", 201);
    } catch (e) {
      console.error("Register error:", e);
      return errorResponse(res, "Register failed");
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
      console.error("Login error:", e);
      return errorResponse(res, "Login failed");
    }
  }
);

module.exports = router;
