import { createRequire } from "node:module";
import { unauthenticated } from "../shopify.server";
import { createTokenAdminClient } from "../utils/adminClient";

const require = createRequire(import.meta.url);

const BUILD_BROCHURE_HTML_MODULE_PATH =
  "../../../../node-pdf-project/backend/pdf/buildBrochureHtml";
const RENDER_PDF_BUFFER_MODULE_PATH =
  "../../../../node-pdf-project/backend/pdf/renderPdfBuffer";

function getPdfModules() {
  const buildPath = require.resolve(BUILD_BROCHURE_HTML_MODULE_PATH);
  const renderPath = require.resolve(RENDER_PDF_BUFFER_MODULE_PATH);

  if (process.env.NODE_ENV !== "production") {
    delete require.cache[buildPath];
    delete require.cache[renderPath];
  }

  const { buildBrochureHtml } = require(buildPath);
  const { renderPdfBuffer } = require(renderPath);

  return { buildBrochureHtml, renderPdfBuffer };
}

function safeFilenamePart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function normalizeShop(value) {
  const shop = String(value || "")
    .trim()
    .toLowerCase();
  if (!shop) return "";
  if (!shop.endsWith(".myshopify.com")) return "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return "";
  return shop;
}

function assertShopAllowed(shop) {
  const allowedRaw = process.env.ALLOWED_STOREFRONT_SHOPS || "";
  const allowed = allowedRaw
    .split(",")
    .map((s) => normalizeShop(s))
    .filter(Boolean);

  if (allowed.length === 0) {
    throw new Response("Storefront access not configured", { status: 500 });
  }

  if (!allowed.includes(shop)) {
    throw new Response("Forbidden", { status: 403 });
  }
}

function optimizeImageUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    u.searchParams.set("width", "250");
    u.searchParams.set("height", "250");
    u.searchParams.set("crop", "center");
    u.searchParams.set("format", "webp");
    u.searchParams.set("quality", "60");
    return u.toString();
  } catch {
    return url;
  }
}

function mapShopifyProductsToPdfProducts(shopifyProducts) {
  return (shopifyProducts || []).map((p) => {
    const v = p?.variants?.edges?.[0]?.node;
    return {
      id: p.id,
      name: p.title || "",
      size: v?.title && !/default\s*title/i.test(v.title) ? v.title : "",
      price: v?.price ? Number(v.price) : "",
      image: optimizeImageUrl(p?.featuredImage?.url || ""),
      category: "",
    };
  });
}

function mapShopifyProductsToPdfProductsWithCategory(shopifyProducts, category) {
  return (shopifyProducts || []).map((p) => {
    const v = p?.variants?.edges?.[0]?.node;
    return {
      id: p.id,
      name: p.title || "",
      size: v?.title && !/default\s*title/i.test(v.title) ? v.title : "",
      price: v?.price ? Number(v.price) : "",
      image: optimizeImageUrl(p?.featuredImage?.url || ""),
      category: category || "",
    };
  });
}

function groupShopifyProductsByCollection(shopifyProducts) {
  const map = new Map();

  for (const p of shopifyProducts || []) {
    const edges = p?.collections?.edges || [];
    const firstCollection = edges[0]?.node;
    const collectionId = firstCollection?.id || "Uncategorized";
    const collectionName = firstCollection?.title || "Uncategorized";

    const key = collectionId;
    if (!map.has(key)) {
      map.set(key, { collectionId, collectionName, products: [] });
    }
    map.get(key).products.push(p);
  }

  return Array.from(map.values());
}

async function fetchCollectionProducts({ admin, collectionId }) {
  const query = `#graphql
    query CollectionProducts($id: ID!, $first: Int!, $after: String) {
      collection(id: $id) {
        title
        products(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              title
              featuredImage { url altText }
              variants(first: 1) {
                edges {
                  node {
                    id
                    price
                    title
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const first = 250;
  let after = null;
  const out = [];
  let collectionTitle = "";

  while (true) {
    const resp = await admin.graphql(query, {
      variables: { id: collectionId, first, after },
    });
    const data = await resp.json();
    collectionTitle = data?.data?.collection?.title || collectionTitle;

    const edges = data?.data?.collection?.products?.edges || [];
    for (const e of edges) out.push(e.node);

    const pageInfo = data?.data?.collection?.products?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    after = pageInfo.endCursor;
  }

  return { products: out, collectionTitle };
}

async function fetchProductsByTag({ admin, tag }) {
  const query = `#graphql
    query ProductsByQuery($first: Int!, $after: String, $query: String!) {
      products(first: $first, after: $after, query: $query) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            title
            collections(first: 10) { edges { node { id title } } }
            featuredImage { url altText }
            variants(first: 1) {
              edges {
                node {
                  id
                  price
                  title
                }
              }
            }
          }
        }
      }
    }
  `;

  const q = `tag:${JSON.stringify(tag)}`;
  const first = 250;
  let after = null;
  const out = [];

  while (true) {
    const resp = await admin.graphql(query, {
      variables: { first, after, query: q },
    });
    const data = await resp.json();

    const edges = data?.data?.products?.edges || [];
    for (const e of edges) out.push(e.node);

    const pageInfo = data?.data?.products?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    after = pageInfo.endCursor;
  }

  return out;
}

function normalizeCollectionId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("gid://")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `gid://shopify/Collection/${trimmed}`;
  return trimmed;
}

export async function loader({ request }) {
  const url = new URL(request.url);

  const shop = normalizeShop(url.searchParams.get("shop"));
  if (!shop) {
    return new Response("Missing or invalid shop", { status: 400 });
  }

  assertShopAllowed(shop);

  const mainShop = normalizeShop(process.env.MAIN_STORE_SHOP);
  const mainToken = process.env.MAIN_STORE_ADMIN_TOKEN || "";
  const admin =
    mainToken && mainShop && shop === mainShop
      ? createTokenAdminClient({ shop, accessToken: mainToken })
      : (await unauthenticated.admin(shop)).admin;
  const { buildBrochureHtml, renderPdfBuffer } = getPdfModules();

  const collectionId = normalizeCollectionId(url.searchParams.get("collectionId"));
  const brandTag = (url.searchParams.get("brand_tag") || "").trim();

  const maxPerPageParam = Number(url.searchParams.get("maxPerPage"));
  const maxPerPage = Number.isFinite(maxPerPageParam) && maxPerPageParam > 0 ? maxPerPageParam : 12;

  if (!collectionId && !brandTag) {
    return new Response("Missing collectionId or brand_tag", { status: 400 });
  }

  let mapped = [];
  let filename = "brochure.pdf";

  if (collectionId) {
    const { products, collectionTitle } = await fetchCollectionProducts({ admin, collectionId });
    mapped = mapShopifyProductsToPdfProductsWithCategory(products, collectionTitle || "");
    filename = `brochure-${safeFilenamePart(collectionTitle || collectionId) || "collection"}.pdf`;
  } else {
    const shopifyProducts = await fetchProductsByTag({ admin, tag: brandTag });
    const grouped = groupShopifyProductsByCollection(shopifyProducts);
    for (const group of grouped) {
      const p = mapShopifyProductsToPdfProductsWithCategory(group.products, group.collectionName);
      mapped.push(...p);
    }
    filename = `brochure-${safeFilenamePart(brandTag) || "brand"}.pdf`;
  }

  if (!mapped.length) {
    return new Response("No products found", { status: 404 });
  }

  const html = buildBrochureHtml({
    products: mapped,
    maxPerPage,
    coverTitle: brandTag ? brandTag : "",
  });
  const pdfBuffer = await renderPdfBuffer({ html });

  return new Response(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename=\"${filename}\"`,
      "Cache-Control": "no-store",
    },
  });
}
