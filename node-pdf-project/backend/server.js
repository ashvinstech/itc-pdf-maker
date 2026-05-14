const express = require('express');
const cors = require('cors');
const path = require('path');

const { products } = require('./data/products');
const { generatePdfRouter } = require('./routes/generatePdf');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/products', (req, res) => {
  res.json({ products });
});

app.use('/', generatePdfRouter);

app.use('/images', express.static(path.join(__dirname, 'public/images')));

const port = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
