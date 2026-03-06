# E-Commerce Inventory & Dynamic Pricing API

A production-grade backend service for e-commerce platforms that handles real-time inventory tracking, dynamic pricing with multiple rule types, and concurrent-safe cart management.

## Table of Contents
- [Architecture & Design Decisions](#architecture--design-decisions)
- [Setup Instructions](#setup-instructions)
- [Running the Application](#running-the-application)
- [Inventory Reservation Flow](#inventory-reservation-flow)
- [Dynamic Pricing Logic](#dynamic-pricing-logic)
- [API Endpoints](#api-endpoints)

---

## Architecture & Design Decisions

### System Architecture

```
Client (HTTP)
     │
     ▼
Express.js API Server
├── Middleware: Helmet, Rate Limiting, Morgan, Joi Validation
├── Controllers (HTTP parsing & response formatting)
├── Services (Business logic)
│   ├── Inventory Service  ──→ SELECT FOR UPDATE (concurrency control)
│   ├── Cart Service       ──→ Price snapshot + reservation
│   └── Pricing Engine     ──→ Rule-based discount application
├── Repositories (Data access layer - repository pattern)
└── PostgreSQL ◄──────────────────────────────────────────
                   Transactions, Indexes, Constraints

Background Worker (BullMQ + Redis)
└── release-expired-reservations (every 60 seconds)
    └── SKIP LOCKED (safe concurrent execution)
```

See `docs/architecture.png` for the full system diagram and `docs/schema.png` for the ERD.

### Key Design Decisions

**Layered Architecture**: Controllers → Services → Repositories → Database. This separation ensures testability, single-responsibility, and easy maintenance. The pricing engine is isolated as its own module.

**Concurrency Control via `SELECT ... FOR UPDATE`**: When a cart add or checkout occurs, the relevant `variants` row is locked within a transaction. This prevents two concurrent requests from both seeing sufficient stock and both proceeding — eliminating the oversell race condition at the database level.

**Price Snapshot**: When an item is added to a cart, the unit price and discount breakdown are stored in `cart_items`. Subsequent changes to pricing rules or base prices do not affect items already in the cart.

**Idempotent Background Jobs**: The cleanup job uses `FOR UPDATE SKIP LOCKED` when selecting expired reservations. This means multiple concurrent worker runs will each safely process a disjoint subset, never double-processing the same reservation.

**JSONB for Flexibility**: Variant `attributes` (e.g., `{"size":"L","color":"Red"}`) and pricing rule `config` are stored as JSONB, allowing extensible schemas without migrations.

---

## Setup Instructions

### Prerequisites
- Node.js 18+
- PostgreSQL 15+
- Redis 7+
- Docker & Docker Compose (optional but recommended)

### Option A: Docker Compose (Recommended)

```bash
# Clone the repository
git clone <repo-url>
cd ecommerce-api

# Start all services (API, Worker, Postgres, Redis)
docker-compose up -d

# Run migrations and seed data
docker-compose exec api npm run migrate
docker-compose exec api npm run seed
```

The API will be available at `http://localhost:3000`.  
Swagger UI: `http://localhost:3000/api-docs`

### Option B: Local Development

```bash
# 1. Start only infrastructure
docker-compose -f docker-compose.dev.yml up -d

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your database credentials

# 4. Run migrations
npm run migrate

# 5. Seed demo data (optional)
npm run seed
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | API server port |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `ecommerce_db` | Database name |
| `DB_USER` | `postgres` | Database user |
| `DB_PASSWORD` | `postgres` | Database password |
| `REDIS_HOST` | `localhost` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `RESERVATION_TTL_MINUTES` | `15` | Cart reservation expiry duration |

---

## Running the Application

```bash
# Start the API server
npm start

# Start the background worker (separate terminal)
npm run worker

# Development mode (auto-reload)
npm run dev

# Run tests
npm test
```

---

## Inventory Reservation Flow

### Adding an Item to Cart

```
POST /api/v1/carts/:cartId/items
{ "variant_id": "...", "quantity": 2 }
```

**Step-by-step:**

1. **Load cart & validate** — verify cart is active, variant exists and is active.
2. **Calculate price snapshot** — pricing engine applies active rules, result is frozen into `cart_items.unit_price`.
3. **Begin DB transaction** — ensures atomicity of steps 4-6.
4. **`SELECT ... FOR UPDATE`** on the `variants` row — acquires a row-level lock, blocking concurrent reservations for the same variant.
5. **Check available stock**:
   ```
   available = stock_quantity - reserved_quantity + existing_reservation_for_this_cart
   ```
   If `quantity > available`, rollback + return HTTP 409.
6. **Upsert `inventory_reservations`** — sets `expires_at = NOW() + 15 minutes`.
7. **Increment `variants.reserved_quantity`** by the delta quantity.
8. **Commit transaction** — lock is released.

### Reservation Expiration (Background Job)

Every 60 seconds, the BullMQ worker runs `release-expired-reservations`:

```sql
-- Find and lock expired reservations (SKIP LOCKED = safe concurrent runs)
SELECT id, variant_id, quantity
FROM inventory_reservations
WHERE status = 'active' AND expires_at < NOW()
FOR UPDATE SKIP LOCKED;

-- Mark as released
UPDATE inventory_reservations SET status = 'released' WHERE id = ANY($ids);

-- Return stock to available pool
UPDATE variants
SET reserved_quantity = GREATEST(0, reserved_quantity - $quantity)
WHERE id = $variant_id;
```

**Idempotency guarantee**: A reservation with `status = 'released'` will never be selected again. `SKIP LOCKED` prevents concurrent workers from processing the same row. `GREATEST(0, ...)` prevents negative reserved counts even if data is inconsistent.

### Checkout Flow

```
POST /api/v1/carts/:cartId/checkout
```

Inside a single transaction, for each cart item:
1. Lock the variant row (`SELECT FOR UPDATE`).
2. Mark the reservation as `converted`.
3. Decrement **both** `stock_quantity` and `reserved_quantity` by the item's quantity.
4. Mark the cart as `checked_out`.
5. Create an `orders` record and `order_items` rows.

---

## Dynamic Pricing Logic

### Rule Types

| Type | Trigger | Config Example |
|---|---|---|
| `seasonal` | Active within `valid_from`/`valid_until` | `{}` |
| `promo_code` | Matching `promo_code` query param | `{"code": "SAVE20"}` |
| `bulk` | `quantity >= min_quantity` | `{"min_quantity": 10}` |
| `user_tier` | Cart's `user_tier` matches | `{"tier": "gold"}` |

### Rule Application Order

Rules are applied sequentially — each rule's discount is computed against the **current running price** after previous discounts:

```
original_price = base_price + variant.price_adjustment

1. seasonal   → current_price = original_price × (1 - 10%)  = $90.00
2. promo_code → current_price = $90.00 × (1 - 20%)          = $72.00
3. bulk       → current_price = $72.00 × (1 - 15%)          = $61.20
4. user_tier  → current_price = $61.20 × (1 - 8%)           = $56.30
```

Only **one rule per type** applies (the best-matching one). For bulk rules, the highest qualifying threshold wins.

### Example: `GET /api/v1/products/:id/price?quantity=15&user_tier=gold&promo_code=SAVE20`

```json
{
  "originalPrice": 999.99,
  "unitPrice": 617.39,
  "totalPrice": 9260.85,
  "appliedDiscounts": [
    { "rule_name": "Summer Sale",       "rule_type": "seasonal",   "discount_amount": 100.00 },
    { "rule_name": "Promo SAVE20",      "rule_type": "promo_code", "discount_amount": 180.00 },
    { "rule_name": "Bulk Discount 10+", "rule_type": "bulk",       "discount_amount": 107.99 },
    { "rule_name": "Gold Tier Discount","rule_type": "user_tier",  "discount_amount": 86.39  }
  ]
}
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/v1/health` | Health check |
| GET/POST | `/api/v1/categories` | List / create categories |
| GET | `/api/v1/categories/tree` | Hierarchical category tree |
| GET/PATCH/DELETE | `/api/v1/categories/:id` | Get / update / delete category |
| GET/POST | `/api/v1/products` | List / create products |
| GET/PATCH/DELETE | `/api/v1/products/:id` | Get (with variants) / update / delete |
| GET | `/api/v1/products/:id/price` | Dynamic price calculation |
| GET/POST | `/api/v1/products/:productId/variants` | List / create variants |
| GET/PATCH/DELETE | `/api/v1/products/:productId/variants/:id` | Variant CRUD |
| GET/POST | `/api/v1/pricing-rules` | List / create pricing rules |
| GET/PATCH/DELETE | `/api/v1/pricing-rules/:id` | Pricing rule CRUD |
| POST | `/api/v1/carts` | Create cart |
| GET | `/api/v1/carts/:cartId` | Get cart with items |
| POST | `/api/v1/carts/:cartId/items` | Add item (with reservation) |
| PATCH | `/api/v1/carts/:cartId/items/:variantId` | Update item quantity |
| DELETE | `/api/v1/carts/:cartId/items/:variantId` | Remove item (releases reservation) |
| POST | `/api/v1/carts/:cartId/checkout` | Checkout (converts reservations) |

Full interactive documentation: `http://localhost:3000/api-docs`
