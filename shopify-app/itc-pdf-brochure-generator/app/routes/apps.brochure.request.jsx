import { createRequire } from "node:module";
import { authenticate } from "../shopify.server";
import { sendCatalogEmail } from "../utils/email";
import { appendLead } from "../utils/leads";
import { uploadPdfToShopifyFiles } from "../utils/storage";

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
            tags
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
      size: v?.title && !/default\s*title/i.test(v.title) ? v.title : "",
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
  const { admin } = await authenticate.public.appProxy(request);
  const { buildBrochureHtml, renderPdfBuffer } = getPdfModules();

  const form = await request.formData();
  const honeypot = (form.get("hp") || "").toString().trim();
  if (honeypot) {
    return new Response("OK", { status: 200 });
  }

  const name = (form.get("name") || "").toString().trim();
  const email = (form.get("email") || "").toString().trim();
  const phone = (form.get("phone") || "").toString().trim();
  const company = (form.get("company") || "").toString().trim();
  const brandTag = (form.get("brand_tag") || "").toString().trim();

  const maxPerPageParam = Number(form.get("maxPerPage"));
  const maxPerPage = Number.isFinite(maxPerPageParam) && maxPerPageParam > 0 ? maxPerPageParam : 12;
  const logoUrl = (form.get("logoUrl") || "").toString().trim();

  const validationError = validateLeadFields({ name, email, phone, brandTag });
  if (validationError) {
    return new Response(validationError, { status: 400 });
  }

  const shopifyProducts = await fetchProductsByTag({ admin, tag: brandTag });
  if (shopifyProducts.length === 0) {
    return new Response("No products found for brand_tag", { status: 404 });
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
    return new Response("No products found for brand_tag", { status: 404 });
  }

  const chunks = chunkArray(orderedMapped, 100);
  const pdfUrls = [];
  const timestamp = Math.floor(Date.now() / 1000);
  const tagPart = safeFilenamePart(brandTag) || "brand";

  for (let i = 0; i < chunks.length; i++) {
    const pdfHtml = await buildBrochureHtml({
      products: chunks[i],
      maxPerPage,
      coverTitle: i === 0 ? brandTag : "",
      logoUrl,
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
    source: "storefront_app_proxy",
  });

  return new Response("OK", { status: 200 });
}
