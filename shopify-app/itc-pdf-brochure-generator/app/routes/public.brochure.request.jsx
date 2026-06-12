import { createRequire } from "node:module";
import { unauthenticated } from "../shopify.server";
import { sendCatalogEmail } from "../utils/email";
import { appendLead } from "../utils/leads";
import { savePdfLocally } from "../utils/storage";
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

function shopFromOrigin(origin) {
  if (typeof origin !== "string" || !origin) return "";
  try {
    const u = new URL(origin);
    const host = (u.hostname || "").toLowerCase();
    return normalizeShop(host);
  } catch {
    return "";
  }
}

function corsHeadersForOrigin(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function getAllowedOrigins() {
  const allowedRaw = process.env.ALLOWED_STOREFRONT_SHOPS || "";
  return allowedRaw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function corsHeadersForRequest(request, shop) {
  const origin = request.headers.get("Origin") || "";
  const originShop = shopFromOrigin(origin);
  const allowedOrigins = getAllowedOrigins();

  // If origin matches the shop domain exactly
  if (origin && originShop && originShop === shop) {
    return corsHeadersForOrigin(origin);
  }

  // If origin hostname is directly in allowlist (for custom domains like uat.itcgifting.com)
  try {
    const u = new URL(origin);
    const hostname = u.hostname.toLowerCase();
    if (allowedOrigins.includes(hostname)) {
      return corsHeadersForOrigin(origin);
    }
  } catch {
    // ignore invalid origin
  }

  return corsHeadersForOrigin(shop ? `https://${shop}` : "");
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

function normalizeCollectionId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("gid://")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `gid://shopify/Collection/${trimmed}`;
  return trimmed;
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
      size: v?.title && !/default\s*title/i.test(v.title) ? v.title : "",
      price: v?.price ? Number(v.price) : "",
      image: optimizeImageUrl(p?.featuredImage?.url || ""),
      category: category || "",
    };
  });
}

function validateLeadFields({ name, email, phone, brandTag, collectionId }) {
  if (!brandTag && !collectionId) return "Missing brand_tag or collectionId";
  if (!name) return "Missing name";
  if (!email) return "Missing email";
  if (!phone) return "Missing phone";
  return null;
}

export async function loader({ request }) {
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("Origin") || "";
    const preflightShop = shopFromOrigin(origin);
    if (!preflightShop) {
      return new Response(null, { status: 204, headers: corsHeadersForOrigin("") });
    }

    try {
      assertShopAllowed(preflightShop);
    } catch (e) {
      if (e instanceof Response) {
        return new Response(await e.text(), {
          status: e.status,
          headers: { ...corsHeadersForOrigin(origin), ...Object.fromEntries(e.headers) },
        });
      }
      throw e;
    }

    return new Response(null, {
      status: 204,
      headers: corsHeadersForOrigin(origin),
    });
  }

  return new Response("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST, OPTIONS" },
  });
}

export async function action({ request }) {
  // Parse form early to get shop for CORS
  const form = await request.formData().catch(() => null);
  const shop = form ? normalizeShop(form.get("shop")) : "";
  const corsHeaders = corsHeadersForRequest(request, shop);

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST, OPTIONS", ...corsHeaders },
    });
  }

  const honeypot = form && (form.get("hp") || "").toString().trim();
  if (honeypot) {
    return new Response("OK", { status: 200, headers: corsHeaders });
  }

  if (!shop) {
    return new Response("Missing or invalid shop", { status: 400, headers: corsHeaders });
  }

  try {
    assertShopAllowed(shop);
  } catch (e) {
    if (e instanceof Response) {
      return new Response(await e.text(), {
        status: e.status,
        headers: { ...corsHeaders, ...Object.fromEntries(e.headers) },
      });
    }
    throw e;
  }

  const name = (form.get("name") || "").toString().trim();
  const email = (form.get("email") || "").toString().trim();
  const phone = (form.get("phone") || "").toString().trim();
  const company = (form.get("company") || "").toString().trim();
  const brandTag = (form.get("brand_tag") || "").toString().trim();
  const collectionId = normalizeCollectionId(
    (form.get("collectionId") || form.get("collection_id") || "").toString(),
  );

  const maxPerPageParam = Number(form.get("maxPerPage"));
  const maxPerPage = Number.isFinite(maxPerPageParam) && maxPerPageParam > 0 ? maxPerPageParam : 12;
  const logoUrl = (form.get("logoUrl") || "").toString().trim();

  const validationError = validateLeadFields({
    name,
    email,
    phone,
    brandTag,
    collectionId,
  });
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

  const orderedMapped = [];
  const groupsSummary = [];
  let coverTitle = "";
  let filenameBase = "catalog";
  let emailContextLabel = "";

  if (collectionId) {
    const { products, collectionTitle } = await fetchCollectionProducts({
      admin,
      collectionId,
    });

    const mapped = mapShopifyProductsToPdfProductsWithCategory(
      products,
      collectionTitle || "",
    );
    orderedMapped.push(...mapped);

    groupsSummary.push({
      collectionId,
      collectionName: collectionTitle || collectionId,
      count: mapped.length,
    });

    coverTitle = collectionTitle || "";
    filenameBase = safeFilenamePart(collectionTitle || collectionId) || "collection";
    emailContextLabel = `Collection: ${collectionTitle || collectionId}`;
  } else {
    const shopifyProducts = await fetchProductsByTag({ admin, tag: brandTag });
    if (shopifyProducts.length === 0) {
      return new Response("No products found for brand_tag", {
        status: 404,
        headers: corsHeaders,
      });
    }

    const grouped = groupShopifyProductsByCollection(shopifyProducts);
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
      return new Response("No products found for brand_tag", {
        status: 404,
        headers: corsHeaders,
      });
    }

    coverTitle = brandTag;
    filenameBase = safeFilenamePart(brandTag) || "brand";
    emailContextLabel = `Brand tag: ${brandTag}`;
  }

  const chunks = chunkArray(orderedMapped, 100);
  const pdfUrls = [];
  const pdfBuffers = [];
  const pdfFilenames = [];
  const timestamp = Math.floor(Date.now() / 1000);
  const tagPart = filenameBase;

  for (let i = 0; i < chunks.length; i++) {
    const pdfHtml = await buildBrochureHtml({
      products: chunks[i],
      maxPerPage,
      coverTitle: i === 0 ? coverTitle : "",
      logoUrl,
    });
    const pdfBuffer = await renderPdfBuffer({ html: pdfHtml });
    const filename = `catalog-${tagPart}-${timestamp}-${i + 1}.pdf`;
    const { url } = await savePdfLocally({
      buffer: pdfBuffer,
      filename,
    });
    pdfUrls.push(url);
    pdfBuffers.push(pdfBuffer);
    pdfFilenames.push(filename);
  }

  try {
    await sendCatalogEmail({
      to: email,
      name,
      collectionName: emailContextLabel,
      pdfUrls,
      pdfBuffers,
      pdfFilenames,
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
    collectionId,
    grouped: groupsSummary,
    pdfUrls,
    shop,
    source: "storefront_public",
  });

  return new Response("OK", { status: 200, headers: corsHeaders });
}
