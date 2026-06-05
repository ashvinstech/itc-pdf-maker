import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function savePdfLocally({ buffer, filename }) {
  const pdfDir = join(process.cwd(), "public", "pdfs");
  await mkdir(pdfDir, { recursive: true });

  const timestamp = Date.now();
  const safeFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "-");
  const finalFilename = `${timestamp}-${safeFilename}`;
  const filePath = join(pdfDir, finalFilename);

  await writeFile(filePath, buffer);

  const baseUrl = process.env.PDF_BASE_URL || "";
  const publicUrl = `${baseUrl}/pdfs/${finalFilename}`;

  return { url: publicUrl, filename: finalFilename };
}

async function fetchFileUrl({ admin, fileId }) {
  const resp = await admin.graphql(
    `#graphql
      query FileUrl($id: ID!) {
        node(id: $id) {
          id
          ... on GenericFile {
            url
          }
          ... on MediaImage {
            image {
              url
            }
          }
        }
      }`,
    { variables: { id: fileId } },
  );

  const json = await resp.json();
  const node = json.data?.node;
  return node?.url || node?.image?.url || null;
}

export async function uploadPdfToShopifyFiles({
  admin,
  buffer,
  filename,
  mimeType = "application/pdf",
}) {
  const stagedResp = await admin.graphql(
    `#graphql
      mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        input: [
          {
            resource: "FILE",
            filename,
            mimeType,
            httpMethod: "POST",
          },
        ],
      },
    },
  );

  const stagedJson = await stagedResp.json();
  const stagedErrors = stagedJson.data?.stagedUploadsCreate?.userErrors;
  if (stagedErrors?.length) {
    throw new Error(stagedErrors.map((e) => e.message).join(", "));
  }

  const target = stagedJson.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url || !Array.isArray(target.parameters)) {
    throw new Error("Failed to stage upload");
  }

  const form = new FormData();
  for (const p of target.parameters) {
    form.append(p.name, p.value);
  }
  form.append("file", new Blob([buffer], { type: mimeType }), filename);

  const uploadResp = await fetch(target.url, {
    method: "POST",
    body: form,
  });

  if (!uploadResp.ok) {
    const text = await uploadResp.text().catch(() => "");
    throw new Error(`Upload failed (${uploadResp.status}) ${text}`);
  }

  const fileCreateResp = await admin.graphql(
    `#graphql
      mutation FileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            fileStatus
            createdAt
            preview {
              image {
                url
              }
            }
            ... on GenericFile {
              url
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        files: [
          {
            contentType: "FILE",
            originalSource: target.resourceUrl,
            alt: filename,
          },
        ],
      },
    },
  );

  const fileCreateJson = await fileCreateResp.json();
  const fileErrors = fileCreateJson.data?.fileCreate?.userErrors;
  if (fileErrors?.length) {
    throw new Error(fileErrors.map((e) => e.message).join(", "));
  }

  const file = fileCreateJson.data?.fileCreate?.files?.[0];
  const fileId = file?.id;
  let url = file?.url || file?.preview?.image?.url || null;

  if (!url && fileId) {
    for (let attempt = 0; attempt < 8; attempt++) {
      await sleep(750);
      url = await fetchFileUrl({ admin, fileId });
      if (url) break;
    }
  }

  if (!url) {
    throw new Error("File created but no URL returned");
  }

  return {
    url,
    fileId: fileId || randomUUID(),
  };
}
