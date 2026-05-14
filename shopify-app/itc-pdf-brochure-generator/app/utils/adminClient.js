const DEFAULT_ADMIN_API_VERSION = "2024-10";

function normalizeShop(value) {
  const shop = String(value || "")
    .trim()
    .toLowerCase();
  if (!shop) return "";
  if (!shop.endsWith(".myshopify.com")) return "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return "";
  return shop;
}

export function createTokenAdminClient({ shop, accessToken }) {
  const normalizedShop = normalizeShop(shop);
  if (!normalizedShop) throw new Error("Invalid shop domain");
  if (!accessToken) throw new Error("Missing access token");

  const apiVersion =
    process.env.SHOPIFY_ADMIN_API_VERSION || DEFAULT_ADMIN_API_VERSION;

  return {
    async graphql(query, { variables } = {}) {
      const resp = await fetch(
        `https://${normalizedShop}/admin/api/${apiVersion}/graphql.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shopify-Access-Token": accessToken,
          },
          body: JSON.stringify({ query, variables: variables || {} }),
        },
      );
      return resp;
    },
  };
}
