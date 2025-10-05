// src/app.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

// DB & Swagger
const { connectDB } = require("./config/database"); // sama seperti di Library
const { swaggerUi, swaggerSpecs } = require("./config/swagger");

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static landing page (public/index.html)
app.use(express.static(path.join(__dirname, "../public")));

// Swagger UI
app.use(
  "/api-swagger",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpecs, {
    customSiteTitle: "E-Commerce API Docs",
  })
);

// ===== Mount Routes (atur sesuai folder routes kamu) =====
app.use("/api/auth", require("./routes/auth")); // register/login
app.use("/api/me", require("./routes/me")); // profile & update
app.use("/api/seller", require("./routes/seller")); // activate/get/patch shop
app.use("/api/categories", require("./routes/categories")); // public categories
app.use("/api/products", require("./routes/products.public")); // public catalog & detail
app.use("/api/seller/products", require("./routes/seller.products")); // seller's products CRUD
app.use("/api/cart", require("./routes/cart")); // user cart
app.use("/api/orders", require("./routes/orders")); // checkout & my orders
app.use("/api/seller/order-items", require("./routes/seller.fulfillment")); // seller order items
app.use("/api/reviews", require("./routes/reviews")); // product reviews
app.use("/api/stores", require("./routes/products.public"));
// rute store ada di file yg sama, path relatif "../stores/:id" → ter-mount sebagai /api/stores/:id
// Health
app.get("/health", (_req, res) =>
  res.json({ success: true, message: "E-Commerce API is running" })
);

// DB connect (Prisma)
connectDB();

module.exports = app;
