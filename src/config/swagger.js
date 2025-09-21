const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");

const options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "E-Commerce API",
      version: "1.0.0",
      description: "REST API for E-Commerce App (Express + Prisma + Neon)",
    },
    servers: [
      {
        url: process.env.SWAGGER_BASE_URL || "http://localhost:8080",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      },
      schemas: {
        // contoh reusable schema
        LoginResponse: {
          type: "object",
          properties: {
            token: { type: "string" },
            user: {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
                email: { type: "string" },
                phone: { type: "string", nullable: true },
                avatarUrl: { type: "string", nullable: true },
              },
            },
          },
        },
      },
    },
    tags: [
      { name: "Auth", description: "Register & Login" },
      { name: "Me", description: "User profile & identity" },
      { name: "Seller", description: "Seller activation & shop" },
      { name: "Products", description: "Public catalog & seller products" },
      { name: "Categories", description: "Product categories" },
      { name: "Cart", description: "Shopping cart per user" },
      { name: "Orders", description: "Checkout & buyer orders" },
      {
        name: "Seller Fulfillment",
        description: "Seller order items handling",
      },
      { name: "Reviews", description: "Product reviews" },
    ],
  },
  apis: ["./src/routes/*.js"], // scan semua route
};

const swaggerSpecs = swaggerJsdoc(options);

module.exports = { swaggerUi, swaggerSpecs };
