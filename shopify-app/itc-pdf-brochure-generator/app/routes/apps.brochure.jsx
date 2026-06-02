import { createRequire } from "node:module";
import { authenticate } from "../shopify.server";

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

function normalizeCollectionId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("gid://")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `gid://shopify/Collection/${trimmed}`;
  return trimmed;
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
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
              tags
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

  while (true) {
    const resp = await admin.graphql(query, {
      variables: { id: collectionId, first, after },
    });
    const data = await resp.json();
    const edges = data?.data?.collection?.products?.edges || [];
    for (const e of edges) out.push(e.node);

    const pageInfo = data?.data?.collection?.products?.pageInfo;
    if (!pageInfo?.hasNextPage) break;
    after = pageInfo.endCursor;
  }

  return { products: out, collectionTitle: data?.data?.collection?.title || "" };
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

export async function loader({ request }) {
  const { admin } = await authenticate.public.appProxy(request);
  const { buildBrochureHtml, renderPdfBuffer } = getPdfModules();

  const url = new URL(request.url);
  const collectionId = normalizeCollectionId(url.searchParams.get("collectionId"));
  const brandTag = (url.searchParams.get("brand_tag") || "").trim();
  const maxPerPageParam = Number(url.searchParams.get("maxPerPage"));
  const maxPerPage = Number.isFinite(maxPerPageParam) && maxPerPageParam > 0 ? maxPerPageParam : 12;

  if (!collectionId && !brandTag) {
    return new Response("Missing collectionId or brand_tag", { status: 400 });
  }

  let pdfBuffer;
  let filename = "brochure.pdf";

  if (collectionId) {
    const { products: shopifyProducts, collectionTitle } = await fetchCollectionProducts({ admin, collectionId });
    const mapped = mapShopifyProductsToPdfProductsWithCategory(shopifyProducts, collectionTitle || "");
    const html = buildBrochureHtml({ products: mapped, maxPerPage });
    pdfBuffer = await renderPdfBuffer({ html });
    filename = `brochure-${(collectionTitle || collectionId).split("/").pop()}.pdf`;
  } else {
    const shopifyProducts = await fetchProductsByTag({ admin, tag: brandTag });
    const grouped = groupShopifyProductsByCollection(shopifyProducts);

    const orderedMapped = [];
    for (const group of grouped) {
      const mapped = mapShopifyProductsToPdfProductsWithCategory(group.products, group.collectionName);
      if (mapped.length) orderedMapped.push(...mapped);
    }

    if (!orderedMapped.length) {
      return new Response("No products found", { status: 404 });
    }

    const html = buildBrochureHtml({
      products: orderedMapped,
      maxPerPage,
      coverTitle: brandTag ? brandTag : "",
    });
    pdfBuffer = await renderPdfBuffer({ html });
    filename = `brochure-${brandTag.replace(/[^a-z0-9-_]+/gi, "-")}.pdf`;
  }

  return new Response(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename=\"${filename}\"`,
      "Cache-Control": "no-store",
    },
  });
}
