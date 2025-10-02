// src/routes/seller.products.js
const router = require("express").Router();
const { body, query, param } = require("express-validator");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const streamifier = require("streamifier");

const { prisma } = require("../config/database");
const { authenticateToken } = require("../middleware/auth");
const { handleValidationErrors } = require("../middleware/validation");
const { successResponse, errorResponse } = require("../utils/response");

// ===== Multer: simpan file di memori agar bisa di-stream ke Cloudinary =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "image/jpeg" ||
      file.mimetype === "image/png" ||
      file.mimetype === "image/webp";
    if (!ok) return cb(new Error("Only JPG/PNG/WEBP allowed"));
    cb(null, true);
  },
});

// ===== Helper Cloudinary upload (single & multiple) =====
function uploadToCloudinary(fileBuffer, folder = "products") {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder }, (err, res) => {
      if (err) return reject(err);
      resolve(res);
    });
    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
}

async function uploadMany(files = [], folder = "products") {
  if (!files.length) return [];
  const results = await Promise.all(
    files.map((f) =>
      uploadToCloudinary(f.buffer, folder).then((r) => r.secure_url)
    )
  );
  return results.filter(Boolean);
}

// util: ambil shop milik user
async function getMyShop(userId) {
  return prisma.shop.findUnique({ where: { ownerId: userId } });
}

const makeSlug = (s) =>
  s
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");

/**
 * @swagger
 * tags:
 *   - name: Products
 *     description: Public catalog & seller products
 */

/**
 * @swagger
 * /api/seller/products:
 *   get:
 *     summary: List products of my shop
 *     tags: [Products]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, minimum: 1, maximum: 50 }
 *     responses:
 *       200: { description: OK }
 *       401: { description: Unauthorized }
 */
router.get(
  "/",
  authenticateToken,
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
    query("isActive").optional().isBoolean().toBoolean(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const shop = await getMyShop(userId);
      if (!shop) return errorResponse(res, "Seller not activated", 400);

      const { q, isActive, page = 1, limit = 20 } = req.query;
      const where = { shopId: shop.id };
      if (typeof isActive === "boolean") where.isActive = isActive;
      if (q) {
        where.OR = [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ];
      }

      const [items, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: { category: true },
          skip: (Number(page) - 1) * Number(limit),
          take: Number(limit),
          orderBy: [{ updatedAt: "desc" }],
        }),
        prisma.product.count({ where }),
      ]);

      return successResponse(res, {
        products: items,
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
 * /api/seller/products:
 *   post:
 *     summary: Create a product in my shop (with file upload)
 *     tags: [Products]
 *     security: [ { bearerAuth: [] } ]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [title, price, stock, categoryId]
 *             properties:
 *               title: { type: string, example: "Keyboard Wireless" }
 *               description: { type: string, nullable: true }
 *               price: { type: integer, minimum: 0, example: 150000 }
 *               stock: { type: integer, minimum: 0, example: 25 }
 *               categoryId: { type: integer, example: 3 }
 *               images:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: Upload 1..n images (JPG/PNG/WEBP, max 5MB/each)
 *               imagesUrl:
 *                 type: array
 *                 items: { type: string, format: uri }
 *                 description: (opsional) alternatif URL kalau tidak upload file
 *               isActive: { type: boolean, default: true }
 *     responses:
 *       201: { description: Created }
 *       400: { description: Bad Request }
 *       401: { description: Unauthorized }
 */
router.post(
  "/",
  authenticateToken,
  upload.array("images", 10),
  [
    body("title").isLength({ min: 1 }),
    body("price").isInt({ min: 0 }),
    body("stock").isInt({ min: 0 }),
    body("categoryId").isInt({ min: 1 }),
    body("isActive").optional().isBoolean().toBoolean(),
    body("description").optional().isString(),
    // imagesUrl as fallback (string or array)
    body("imagesUrl").optional(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const shop = await getMyShop(userId);
      if (!shop) return errorResponse(res, "Seller not activated", 400);

      const {
        title,
        description,
        price,
        stock,
        categoryId,
        isActive = true,
      } = req.body;

      // 1) Upload file ke Cloudinary (kalau ada)
      const uploadedUrls = await uploadMany(req.files || [], "products");

      // 2) Fallback: imagesUrl (bisa string tunggal atau array)
      let imagesUrl = [];
      const raw = req.body.imagesUrl;
      if (raw) {
        if (Array.isArray(raw)) imagesUrl = raw.filter(Boolean);
        else if (typeof raw === "string" && raw.trim())
          imagesUrl = [raw.trim()];
      }

      const finalImages = [...uploadedUrls, ...imagesUrl];

      // 3) slug sederhana
      const slug = `${makeSlug(title)}-${Date.now()}`;

      const created = await prisma.product.create({
        data: {
          shopId: shop.id,
          categoryId: Number(categoryId),
          title,
          slug,
          description: description ?? null,
          price: Number(price),
          stock: Number(stock),
          images: finalImages, // <= simpan URL hasil upload
          isActive: Boolean(isActive),
        },
      });

      return successResponse(res, created, "Created", 201);
    } catch (e) {
      console.error("Create product error:", e);
      if (String(e?.message || "").includes("Only JPG/PNG/WEBP allowed")) {
        return errorResponse(res, "Only JPG/PNG/WEBP allowed", 400);
      }
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/seller/products/{id}:
 *   put:
 *     summary: Update my product (supports file upload)
 *     tags: [Products]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               description: { type: string, nullable: true }
 *               price: { type: integer, minimum: 0 }
 *               stock: { type: integer, minimum: 0 }
 *               categoryId: { type: integer }
 *               isActive: { type: boolean }
 *               images:
 *                 type: array
 *                 items: { type: string, format: binary }
 *                 description: Upload baru → akan MENIMPA images lama kecuali merge=true
 *               imagesUrl:
 *                 type: array
 *                 items: { type: string, format: uri }
 *               merge:
 *                 type: boolean
 *                 description: true → gabung dengan gambar lama; false (default) → replace
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Not found }
 */
router.put(
  "/:id",
  authenticateToken,
  upload.array("images", 10),
  [
    param("id").isInt({ min: 1 }),
    body("title").optional().isLength({ min: 1 }),
    body("price").optional().isInt({ min: 0 }),
    body("stock").optional().isInt({ min: 0 }),
    body("categoryId").optional().isInt({ min: 1 }),
    body("isActive").optional().isBoolean().toBoolean(),
    body("description").optional().isString(),
    body("merge").optional().isBoolean().toBoolean(),
    body("imagesUrl").optional(),
  ],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const shop = await getMyShop(userId);
      if (!shop) return errorResponse(res, "Seller not activated", 400);

      const id = Number(req.params.id);
      const existing = await prisma.product.findUnique({ where: { id } });
      if (!existing || existing.shopId !== shop.id)
        return errorResponse(res, "Product not found", 404);

      // Upload baru (jika ada file)
      const uploadedUrls = await uploadMany(req.files || [], "products");

      // Fallback images url
      let imagesUrl = [];
      const raw = req.body.imagesUrl;
      if (raw) {
        if (Array.isArray(raw)) imagesUrl = raw.filter(Boolean);
        else if (typeof raw === "string" && raw.trim())
          imagesUrl = [raw.trim()];
      }

      // Tentukan final images
      const merge = Boolean(req.body.merge);
      let finalImages = existing.images || [];
      const newImages = [...uploadedUrls, ...imagesUrl];

      if (newImages.length) {
        finalImages = merge ? [...finalImages, ...newImages] : newImages;
      } // jika tidak ada input, biarkan images lama

      const data = {
        ...(req.body.title && { title: req.body.title }),
        ...(req.body.description !== undefined && {
          description: req.body.description,
        }),
        ...(req.body.price !== undefined && { price: Number(req.body.price) }),
        ...(req.body.stock !== undefined && { stock: Number(req.body.stock) }),
        ...(req.body.categoryId !== undefined && {
          categoryId: Number(req.body.categoryId),
        }),
        ...(req.body.isActive !== undefined && {
          isActive: Boolean(req.body.isActive),
        }),
        ...(newImages.length ? { images: finalImages } : {}), // update images hanya kalau ada input baru
      };

      const updated = await prisma.product.update({
        where: { id },
        data,
      });

      return successResponse(res, updated, "Updated");
    } catch (e) {
      console.error("Update product error:", e);
      if (String(e?.message || "").includes("Only JPG/PNG/WEBP allowed")) {
        return errorResponse(res, "Only JPG/PNG/WEBP allowed", 400);
      }
      return errorResponse(res);
    }
  }
);

/**
 * @swagger
 * /api/seller/products/{id}:
 *   delete:
 *     summary: Delete my product (safe delete)
 *     tags: [Products]
 *     security: [ { bearerAuth: [] } ]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200: { description: Deleted or deactivated }
 *       404: { description: Not found }
 */
router.delete(
  "/:id",
  authenticateToken,
  [param("id").isInt({ min: 1 })],
  handleValidationErrors,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const shop = await getMyShop(userId);
      if (!shop) return errorResponse(res, "Seller not activated", 400);

      const id = Number(req.params.id);
      const product = await prisma.product.findUnique({ where: { id } });
      if (!product || product.shopId !== shop.id)
        return errorResponse(res, "Product not found", 404);

      // cek order aktif untuk produk ini di toko ini
      const activeOrderItem = await prisma.orderItem.findFirst({
        where: {
          productId: id,
          shopId: shop.id,
          status: { in: ["NEW", "CONFIRMED", "SHIPPED"] },
        },
        select: { id: true },
      });

      if (activeOrderItem) {
        // safe delete → nonaktifkan saja
        const deactivated = await prisma.product.update({
          where: { id },
          data: { isActive: false },
        });
        return successResponse(
          res,
          deactivated,
          "Product is used by active orders, set to inactive instead"
        );
      }

      const deleted = await prisma.product.delete({ where: { id } });
      return successResponse(res, deleted, "Deleted");
    } catch (e) {
      console.error(e);
      return errorResponse(res);
    }
  }
);

module.exports = router;
