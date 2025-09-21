// src/server.js
require("dotenv").config();
const app = require("./app");
const listEndpoints = require("express-list-endpoints");

const PORT = process.env.PORT || 8080;

// Log daftar endpoint saat boot
console.log(
  "📜 Registered Routes:",
  listEndpoints(app).map((r) => r.path)
);

app.listen(PORT, () => {
  const base = process.env.SWAGGER_BASE_URL || `http://localhost:${PORT}`;
  console.log(`🛒 E-Commerce API running on port ${PORT}`);
  console.log(`📍 Health: ${base}/health`);
  console.log(`📍 Swagger: ${base}/api-swagger`);
});
