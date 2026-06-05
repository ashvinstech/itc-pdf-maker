import { createRequire } from "node:module";
import { authenticate } from "../shopify.server";
import { uploadPdfToShopifyFiles } from "../utils/storage";
import { sendCatalogEmail } from "../utils/email";
import { appendLead } from "../utils/leads";

const require = createRequire(import.meta.url);

function jsonResponse(data, init) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
}

function mapShopifyProductsToPdfProductsWithCategory(shopifyProducts, category) {
  const mapped = mapShopifyProductsToPdfProducts(shopifyProducts);
  return mapped.map((p) => ({ ...p, category }));
}

function chunkArray(items, chunkSize) {
  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function safeFilenamePart(value) {
  return String(value)
    .replaceAll("gid://shopify/Collection/", "")
    .replaceAll("/", "-")
    .replaceAll(":", "-")
    .replaceAll(" ", "-")
    .slice(0, 64);
}

function normalizeCollectionId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("gid://")) return trimmed;
  if (/^\d+$/.test(trimmed)) return `gid://shopify/Collection/${trimmed}`;
  return trimmed;
}

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

async function fetchCollectionProducts({ admin, collectionId }) {
  const query = `#graphql
    query CollectionProducts($id: ID!, $first: Int!, $after: String) {
      collection(id: $id) {
        products(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              title
              productType
              images(first: 1) {
                edges {
                  node {
                    url
                  }
                }
              }
              variants(first: 1) {
                edges {
                  node {
                    price
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const all = [];
  let after = null;

  for (;;) {
    const response = await admin.graphql(query, {
      variables: {
        id: collectionId,
        first: 250,
        after,
      },
    });

    const responseJson = await response.json();

    if (responseJson.errors?.length) {
      throw new Error(responseJson.errors.map((e) => e.message).join(", "));
    }

    const productsConnection = responseJson.data?.collection?.products;
    if (!productsConnection) {
      throw new Error("Collection not found or no access");
    }

    const edges = Array.isArray(productsConnection.edges)
      ? productsConnection.edges
      : [];

    for (const edge of edges) {
      if (edge?.node) all.push(edge.node);
    }

    if (!productsConnection.pageInfo?.hasNextPage) break;
    after = productsConnection.pageInfo?.endCursor;
    if (!after) break;
  }

  return all;
}

async function fetchProductsByTag({ admin, tag }) {
  const query = `#graphql
    query ProductsByTag($first: Int!, $after: String, $query: String!) {
      products(first: $first, after: $after, query: $query) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            title
            productType
            images(first: 1) {
              edges {
                node {
                  url
                }
              }
            }
            variants(first: 1) {
              edges {
                node {
                  price
                }
              }
            }
            collections(first: 20) {
              edges {
                node {
                  id
                  title
                }
              }
            }
          }
        }
      }
    }
  `;

  const all = [];
  let after = null;

  for (;;) {
    const response = await admin.graphql(query, {
      variables: {
        first: 250,
        after,
        query: `tag:${tag}`,
      },
    });

    const responseJson = await response.json();

    if (responseJson.errors?.length) {
      throw new Error(responseJson.errors.map((e) => e.message).join(", "));
    }

    const productsConnection = responseJson.data?.products;
    if (!productsConnection) {
      throw new Error("Failed to fetch products");
    }

    const edges = Array.isArray(productsConnection.edges)
      ? productsConnection.edges
      : [];

    for (const edge of edges) {
      if (edge?.node) all.push(edge.node);
    }

    if (!productsConnection.pageInfo?.hasNextPage) break;
    after = productsConnection.pageInfo?.endCursor;
    if (!after) break;
  }

  return all;
}

function groupShopifyProductsByCollection(shopifyProducts) {
  const map = new Map();

  for (const p of shopifyProducts) {
    const collectionsEdges = p?.collections?.edges;
    const collections = Array.isArray(collectionsEdges)
      ? collectionsEdges.map((e) => e?.node).filter(Boolean)
      : [];

    if (collections.length === 0) {
      const key = "__no_collection__";
      if (!map.has(key)) {
        map.set(key, { collectionId: key, collectionName: "Uncategorized", products: [] });
      }
      map.get(key).products.push(p);
      continue;
    }

    for (const c of collections) {
      const key = c.id;
      if (!map.has(key)) {
        map.set(key, { collectionId: c.id, collectionName: c.title || c.id, products: [] });
      }
      map.get(key).products.push(p);
    }
  }

  return Array.from(map.values());
}

function optimizeShopifyImageUrl(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const u = new URL(url);
    u.searchParams.set("width", "250");
    u.searchParams.set("quality", "60");
    u.searchParams.set("format", "webp");
    return u.toString();
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}width=250&quality=60&format=webp`;
  }
}

function mapShopifyProductsToPdfProducts(shopifyProducts) {
  return shopifyProducts.map((p) => {
    const imageUrl = optimizeShopifyImageUrl(p?.images?.edges?.[0]?.node?.url || "");
    const priceRaw = p?.variants?.edges?.[0]?.node?.price;
    const price = typeof priceRaw === "string" ? Number(priceRaw) : priceRaw;

    return {
      id: p?.id || "",
      name: p?.title || "",
      category: p?.productType || "Products",
      size: "",
      price: Number.isFinite(price) ? price : (priceRaw ?? ""),
      image: imageUrl,
    };
  });
}

export async function action({ request }) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" }
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    try {
      const raw = await request.text();
      body = JSON.parse(raw);
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, { status: 400 });
    }
  }

  if (body?.mode === "test") {
    return jsonResponse({ ok: true, received: body }, { status: 200 });
  }

  try {
    const { admin } = await authenticate.admin(request);
    const { buildBrochureHtml, renderPdfBuffer } = getPdfModules();

    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const company = typeof body?.company === "string" ? body.company.trim() : "";

    const collectionId = normalizeCollectionId(body?.collectionId);
    const brandTag = typeof body?.brand_tag === "string" ? body.brand_tag.trim() : "";

    if (!collectionId && !brandTag) {
      return jsonResponse(
        { error: "Missing collectionId or brand_tag" },
        { status: 400 },
      );
    }

    const maxPerPage = typeof body?.maxPerPage === "number" ? body.maxPerPage : 12;
    const logoUrl = typeof body?.logoUrl === "string" ? body.logoUrl.trim() : "";

    if (collectionId) {
      const shopifyProducts = await fetchCollectionProducts({ admin, collectionId });
      let mapped = mapShopifyProductsToPdfProducts(shopifyProducts);

      if (mapped.length === 0) {
        return jsonResponse(
          { error: "No products found in collection" },
          { status: 404 },
        );
      }

      const filterIds = Array.isArray(body?.products) ? body.products : [];
      if (filterIds.length > 0) {
        const filterSet = new Set(filterIds);
        mapped = mapped.filter(
          (p) => filterSet.has(p.id) || filterSet.has(String(p.id)),
        );
      }

      if (mapped.length === 0) {
        return jsonResponse(
          { error: "No products found in collection" },
          { status: 404 },
        );
      }

      if (!email) {
        const pdfHtml = buildBrochureHtml({ products: mapped, maxPerPage });
        const pdfBuffer = await renderPdfBuffer({ html: pdfHtml });

        return new Response(pdfBuffer, {
          status: 200,
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": "inline; filename=\"brochure.pdf\""
          }
        });
      }

      const chunks = chunkArray(mapped, 100);
      const timestamp = Math.floor(Date.now() / 1000);
      const base = safeFilenamePart(collectionId);

      const pdfBuffers = [];
      for (const chunk of chunks) {
        const pdfHtml = buildBrochureHtml({ products: chunk, maxPerPage });
        const pdfBuffer = await renderPdfBuffer({ html: pdfHtml });
        pdfBuffers.push(pdfBuffer);
      }

      const pdfUrls = [];
      for (let i = 0; i < pdfBuffers.length; i++) {
        const filename = `catalog-${base}-${timestamp}-${i + 1}.pdf`;
        const { url } = await uploadPdfToShopifyFiles({
          admin,
          buffer: pdfBuffers[i],
          filename,
        });
        pdfUrls.push(url);
      }

      try {
        const collectionName =
          typeof body?.collectionName === "string" && body.collectionName.trim()
            ? body.collectionName.trim()
            : collectionId;

        await sendCatalogEmail({
          to: email,
          name,
          collectionName,
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
        collectionId,
        pdfUrls,
      });

      return jsonResponse(
        {
          success: true,
          message: "Catalog links sent to email",
        },
        { status: 200 },
      );
    }

    if (!email) {
      return jsonResponse(
        { error: "Email is required when using brand_tag" },
        { status: 400 },
      );
    }

    const shopifyProducts = await fetchProductsByTag({ admin, tag: brandTag });
    if (shopifyProducts.length === 0) {
      return jsonResponse(
        { error: "No products found for brand_tag" },
        { status: 404 },
      );
    }

    const grouped = groupShopifyProductsByCollection(shopifyProducts);
    const timestamp = Math.floor(Date.now() / 1000);
    const tagPart = safeFilenamePart(brandTag);

    const orderedMapped = [];
    const groupsSummary = [];

    for (const group of grouped) {
      const mapped = mapShopifyProductsToPdfProductsWithCategory(
        group.products,
        group.collectionName,
      );
      if (mapped.length === 0) continue;
      orderedMapped.push(...mapped);
      groupsSummary.push({
        collectionId: group.collectionId,
        collectionName: group.collectionName,
        count: mapped.length,
      });
    }

    if (orderedMapped.length === 0) {
      return jsonResponse(
        { error: "No PDFs generated for brand_tag" },
        { status: 500 },
      );
    }

    const chunks = chunkArray(orderedMapped, 100);
    const pdfUrls = [];
    for (let i = 0; i < chunks.length; i++) {
      const pdfHtml = buildBrochureHtml({
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
      const collectionName = `Brand tag: ${brandTag}`;
      await sendCatalogEmail({
        to: email,
        name,
        collectionName,
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
    });

    return jsonResponse(
      {
        success: true,
        message: "Catalog links sent to email",
        groups: groupsSummary,
        pdfUrls,
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof Response) {
      return err;
    }
    console.error(err);
    return jsonResponse(
      {
        error: "Failed to generate PDF",
        details: err?.message || String(err)
      },
      { status: 500 }
    );
  }
}
