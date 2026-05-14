# Product Brochure PDF Generator

## Backend

1. Install

```bash
npm install
```

2. Run

```bash
npm run dev
```

Backend runs on `http://localhost:4000`.

Endpoints:

- `GET /products`
- `POST /generate-pdf` with body `{ "products": [1,2,3] }`

## Frontend

1. Install

```bash
npm install
```

2. Run

```bash
npm run dev
```

Frontend runs on `http://localhost:3000`.

You can set backend URL:

```bash
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
```
