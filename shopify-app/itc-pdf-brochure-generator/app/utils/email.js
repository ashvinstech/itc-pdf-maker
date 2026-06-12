import nodemailer from "nodemailer";

// SES limit is 10MB total email size; use 8MB to be safe for attachments
const ATTACHMENT_SIZE_LIMIT = 8 * 1024 * 1024;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getButtonStyle() {
  return "display:inline-block;padding:12px 20px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-family:system-ui,-apple-system,sans-serif;font-size:14px;margin:8px 0;";
}

export async function sendCatalogEmail({
  to,
  name,
  collectionName,
  pdfUrls,
  pdfBuffers,
  pdfFilenames,
}) {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const fromEmail = process.env.FROM_EMAIL || "giftingcatalog@itcgifting.com";

  if (!user) throw new Error("Missing EMAIL_USER");
  if (!pass) throw new Error("Missing EMAIL_PASS");

  const transporter = nodemailer.createTransport({
    host: "email-smtp.ap-south-1.amazonaws.com",
    port: 587,
    secure: false,
    auth: {
      user,
      pass,
    },
  });

  const safeName = name ? escapeHtml(name) : "there";
  const safeCollection = collectionName ? escapeHtml(collectionName) : "your selection";

  // Calculate total size if buffers provided
  let totalSize = 0;
  const canAttach = pdfBuffers && pdfBuffers.length > 0 && (() => {
    totalSize = pdfBuffers.reduce((sum, buf) => sum + (buf?.length || 0), 0);
    return totalSize <= ATTACHMENT_SIZE_LIMIT;
  })();

  let attachments = [];
  let contentHtml = "";

  if (canAttach && pdfFilenames) {
    // Attach PDFs directly
    attachments = pdfBuffers.map((buf, idx) => ({
      filename: pdfFilenames[idx] || `catalog-${idx + 1}.pdf`,
      content: buf,
      contentType: "application/pdf",
    }));
    contentHtml = `<p>Your catalog is attached (${(totalSize / 1024 / 1024).toFixed(1)} MB).</p>`;
  } else {
    // Show styled buttons for links
    if (pdfUrls.length === 1) {
      contentHtml = `<p><a href="${escapeHtml(pdfUrls[0])}" target="_blank" rel="noreferrer" style="${getButtonStyle()}">Download Catalog</a></p>`;
    } else {
      const buttons = pdfUrls
        .map((url, idx) => {
          const label = `Download Part ${idx + 1}`;
          return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer" style="${getButtonStyle()}">${escapeHtml(label)}</a>`;
        })
        .join("<br/>");
      contentHtml = `<p>Your catalog has ${pdfUrls.length} parts:</p><p>${buttons}</p>`;
    }
    if (totalSize > 0) {
      contentHtml += `<p style="font-size:12px;color:#666;">PDFs are too large (${(totalSize / 1024 / 1024).toFixed(1)} MB) to attach. Please use the download links above.</p>`;
    }
  }

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;padding:20px;">
      <p>Hi ${safeName},</p>
      <p>Your product catalog is ready for <strong>${safeCollection}</strong>.</p>
      ${contentHtml}
      <p style="margin-top:24px;">Regards,<br/>Team ITC Gifting</p>
    </div>
  `;

  await transporter.sendMail({
    from: fromEmail,
    to,
    subject: "Your Product Catalog",
    html,
    attachments,
  });
}
