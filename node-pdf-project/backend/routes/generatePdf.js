const express = require('express');

const { products } = require('../data/products');
const { buildBrochureHtml } = require('../pdf/buildBrochureHtml');
const { renderPdfBuffer } = require('../pdf/renderPdfBuffer');

const generatePdfRouter = express.Router();

generatePdfRouter.post('/generate-pdf', async (req, res) => {
  try {
    const productIds = Array.isArray(req.body?.products) ? req.body.products : [];

    if (productIds.length === 0) {
      return res.status(400).json({ error: 'No products selected' });
    }

    const selected = products.filter((p) => productIds.includes(p.id));

    if (selected.length === 0) {
      return res.status(404).json({ error: 'Selected products not found' });
    }

    const pdfHtml = buildBrochureHtml({ products: selected, maxPerPage: 6 });
    const pdfBuffer = await renderPdfBuffer({ html: pdfHtml });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="brochure.pdf"');

    return res.status(200).send(pdfBuffer);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to generate PDF', details: err?.message || String(err) });
  }
});

module.exports = { generatePdfRouter };
