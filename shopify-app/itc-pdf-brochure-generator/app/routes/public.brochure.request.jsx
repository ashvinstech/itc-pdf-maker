import { createRequire } from "node:module";
import { unauthenticated } from "../shopify.server";
import { sendCatalogEmail } from "../utils/email";
import { appendLead } from "../utils/leads";
import { uploadPdfToShopifyFiles } from "../utils/storage";
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

function corsHeadersForShop(shop) {
  const origin = shop ? `https://${shop}` : "";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
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

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
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

function mapShopifyProductsToPdfProductsWithCategory(shopifyProducts, category) {
  return (shopifyProducts || []).map((p) => {
    const v = p?.variants?.edges?.[0]?.node;
    return {
      id: p.id,
      name: p.title || "",
      size: v?.title || "",
      price: v?.price ? Number(v.price) : "",
      image: optimizeImageUrl(p?.featuredImage?.url || ""),
      category: category || "",
    };
  });
}

function validateLeadFields({ name, email, phone, brandTag }) {
  if (!brandTag) return "Missing brand_tag";
  if (!name) return "Missing name";
  if (!email) return "Missing email";
  if (!phone) return "Missing phone";
  return null;
}

export async function action({ request }) {
  if (request.method === "OPTIONS") {
    const url = new URL(request.url);
    const preflightShop = normalizeShop(url.searchParams.get("shop"));
    if (!preflightShop) {
      return new Response(null, { status: 204 });
    }
    try {
      assertShopAllowed(preflightShop);
    } catch (e) {
      if (e instanceof Response) return e;
      throw e;
    }
    return new Response(null, {
      status: 204,
      headers: corsHeadersForShop(preflightShop),
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST, OPTIONS" },
    });
  }

  const form = await request.formData();
  const honeypot = (form.get("hp") || "").toString().trim();
  if (honeypot) {
    return new Response("OK", { status: 200 });
  }

  const shop = normalizeShop(form.get("shop"));
  if (!shop) {
    return new Response("Missing or invalid shop", { status: 400 });
  }

  const corsHeaders = corsHeadersForShop(shop);

  try {
    assertShopAllowed(shop);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const name = (form.get("name") || "").toString().trim();
  const email = (form.get("email") || "").toString().trim();
  const phone = (form.get("phone") || "").toString().trim();
  const company = (form.get("company") || "").toString().trim();
  const brandTag = (form.get("brand_tag") || "").toString().trim();

  const maxPerPageParam = Number(form.get("maxPerPage"));
  const maxPerPage = Number.isFinite(maxPerPageParam) && maxPerPageParam > 0 ? maxPerPageParam : 12;

  const validationError = validateLeadFields({ name, email, phone, brandTag });
  if (validationError) {
    return new Response(validationError, { status: 400, headers: corsHeaders });
  }

  const mainShop = normalizeShop(process.env.MAIN_STORE_SHOP);
  const mainToken = process.env.MAIN_STORE_ADMIN_TOKEN || "";

  let admin;
  try {
    admin =
      mainToken && mainShop && shop === mainShop
        ? createTokenAdminClient({ shop, accessToken: mainToken })
        : (await unauthenticated.admin(shop)).admin;
  } catch (e) {
    if (e instanceof Response) return e;
    console.error("Failed to create admin client", e);
    return new Response(
      "Unauthorized. App session not found for this shop. Ensure the app is installed on the shop, or configure MAIN_STORE_SHOP/MAIN_STORE_ADMIN_TOKEN for token-based access.",
      { status: 401, headers: corsHeaders },
    );
  }
  const { buildBrochureHtml, renderPdfBuffer } = getPdfModules();

  const shopifyProducts = await fetchProductsByTag({ admin, tag: brandTag });
  if (shopifyProducts.length === 0) {
    return new Response("No products found for brand_tag", { status: 404, headers: corsHeaders });
  }

  const grouped = groupShopifyProductsByCollection(shopifyProducts);

  const orderedMapped = [];
  const groupsSummary = [];
  for (const group of grouped) {
    const mapped = mapShopifyProductsToPdfProductsWithCategory(
      group.products,
      group.collectionName,
    );
    if (!mapped.length) continue;
    orderedMapped.push(...mapped);
    groupsSummary.push({
      collectionId: group.collectionId,
      collectionName: group.collectionName,
      count: mapped.length,
    });
  }

  if (!orderedMapped.length) {
    return new Response("No products found for brand_tag", { status: 404, headers: corsHeaders });
  }

  const chunks = chunkArray(orderedMapped, 100);
  const pdfUrls = [];
  const timestamp = Math.floor(Date.now() / 1000);
  const tagPart = safeFilenamePart(brandTag) || "brand";

  for (let i = 0; i < chunks.length; i++) {
    const pdfHtml = buildBrochureHtml({
      products: chunks[i],
      maxPerPage,
      coverTitle: i === 0 ? brandTag : "",
    });
    const pdfBuffer = await renderPdfBuffer({ html: pdfHtml });
    const filename = `catalog-${tagPart}-${timestamp}-${i + 1}.pdf`;
    const { url } = await uploadPdfToShopifyFiles({
      admin,
      buffer: pdfBuffer,
      filename,
    });
    pdfUrls.push(url);
  }

  try {
    await sendCatalogEmail({
      to: email,
      name,
      collectionName: `Brand tag: ${brandTag}`,
      pdfUrls,
    });
  } catch (emailErr) {
    console.error(emailErr);
  }

  await appendLead({
    name,
    email,
    phone,
    company,
    brand_tag: brandTag,
    grouped: groupsSummary,
    pdfUrls,
    shop,
    source: "storefront_public",
  });

  return new Response("OK", { status: 200, headers: corsHeaders });
}
