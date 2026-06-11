import nodemailer from "nodemailer";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendCatalogEmail({
  to,
  name,
  collectionName,
  pdfUrls,
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

  const linksHtml =
    pdfUrls.length === 1
      ? `<p><a href="${escapeHtml(
          pdfUrls[0],
        )}" target="_blank" rel="noreferrer" style="display:inline-block;padding:10px 14px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px">Download catalog</a></p>`
      : `<ol>${pdfUrls
          .map((url, idx) => {
            const label = `Download catalog part ${idx + 1}`;
            return `<li style="margin: 6px 0"><a href="${escapeHtml(
              url,
            )}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a></li>`;
          })
          .join("")}</ol>`;

  const html = `
    <p>Hi ${safeName},</p>
    <p>Your product catalog is ready for <strong>${safeCollection}</strong>.</p>
    ${linksHtml}
    <p>Regards,<br/>Team</p>
  `;

  await transporter.sendMail({
    from: fromEmail,
    to,
    subject: "Your Product Catalog",
    html,
  });
}
