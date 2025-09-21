require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// helper slugify
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

async function main() {
  console.log("🌱 Seeding e-commerce data…");

  // Users
  const u1 = await prisma.user.upsert({
    where: { email: "alice@example.com" },
    update: {},
    create: {
      name: "Alice",
      email: "alice@example.com",
      password: "$2b$10$DozeVBO6kNpDVViahTmYUeIZj43M4mwaDBFe5lRGgh3V7Zbza9Rj.", // bcrypt("admin123")
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Alice",
    },
  });

  const u2 = await prisma.user.upsert({
    where: { email: "bob@example.com" },
    update: {},
    create: {
      name: "Bob",
      email: "bob@example.com",
      password: "$2b$10$DozeVBO6kNpDVViahTmYUeIZj43M4mwaDBFe5lRGgh3V7Zbza9Rj.",
      avatarUrl: "https://api.dicebear.com/7.x/avataaars/svg?seed=Bob",
    },
  });

  // Shops
  const shop1 = await prisma.shop.upsert({
    where: { slug: "gadget-hub" },
    update: {},
    create: {
      ownerId: u1.id,
      name: "Gadget Hub",
      slug: "gadget-hub",
      logo: "https://images.unsplash.com/photo-1518779578993-ec3579fee39f?q=80&w=512&auto=format&fit=crop",
      address: "Jl. Sudirman No. 10, Jakarta",
      isActive: true,
    },
  });

  const shop2 = await prisma.shop.upsert({
    where: { slug: "urban-fashion" },
    update: {},
    create: {
      ownerId: u2.id,
      name: "Urban Fashion",
      slug: "urban-fashion",
      logo: "https://images.unsplash.com/photo-1521335629791-ce4aec67dd53?q=80&w=512&auto=format&fit=crop",
      address: "Jl. Thamrin No. 5, Jakarta",
      isActive: true,
    },
  });

  // Categories
  const catNames = ["Electronics", "Fashion", "Home Appliances"];
  const categories = [];
  for (const name of catNames) {
    const c = await prisma.category.upsert({
      where: { slug: slugify(name) },
      update: {},
      create: { name, slug: slugify(name) },
    });
    categories.push(c);
  }

  // Products
  await prisma.product.upsert({
    where: { slug: slugify("Wireless Headphones ZX-100") },
    update: {},
    create: {
      shopId: shop1.id,
      categoryId: categories[0].id, // Electronics
      title: "Wireless Headphones ZX-100", // pakai title
      slug: slugify("Wireless Headphones ZX-100"),
      description:
        "Headphone nirkabel dengan noise-cancelling & baterai 30 jam.",
      price: 1250000,
      stock: 25,
      images: [
        "https://images.unsplash.com/photo-1518441902113-c1dba615d35c?q=80&w=800&auto=format&fit=crop",
        "https://images.unsplash.com/photo-1519389950473-47ba0277781c?q=80&w=800&auto=format&fit=crop",
      ],
      rating: 0,
      reviewCount: 0,
      soldCount: 0,
      isActive: true,
    },
  });

  await prisma.product.upsert({
    where: { slug: slugify("Classic Denim Jacket") },
    update: {},
    create: {
      shopId: shop2.id,
      categoryId: categories[1].id, // Fashion
      title: "Classic Denim Jacket",
      slug: slugify("Classic Denim Jacket"),
      description: "Jaket denim klasik unisex dengan bahan premium.",
      price: 550000,
      stock: 40,
      images: [
        "https://images.unsplash.com/photo-1521335629791-ce4aec67dd53?q=80&w=800&auto=format&fit=crop",
      ],
      rating: 0,
      reviewCount: 0,
      soldCount: 0,
      isActive: true,
    },
  });

  console.log("✅ Seed done!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
