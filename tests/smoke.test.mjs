// Storefront + Store API smoke test against a running stack (needs the demo seed).
//   npm run test:smoke                       (local dev: reads .env)
//   STOREFRONT_URL=... BACKEND_URL=... PUBLISHABLE_KEY=... npm run test:smoke
// Covers pages, catalog/prices, cart operations and a full checkout with the
// built-in test payment provider (pp_system_default).
import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"

const dotenv = fs.existsSync(".env")
  ? Object.fromEntries(
      fs
        .readFileSync(".env", "utf8")
        .split("\n")
        .filter((line) => /^[A-Z0-9_]+=/.test(line))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)])
    )
  : {}

const STOREFRONT = process.env.STOREFRONT_URL || "http://localhost:8000"
const BACKEND = process.env.BACKEND_URL || dotenv.NEXT_PUBLIC_MEDUSA_BACKEND_URL || "http://localhost:9000"
const KEY = process.env.PUBLISHABLE_KEY || dotenv.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY
const COUNTRY = process.env.COUNTRY || dotenv.NEXT_PUBLIC_DEFAULT_REGION || "de"

assert.ok(KEY, "PUBLISHABLE_KEY (or NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY in .env) is required")

async function store(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: { "x-publishable-api-key": KEY, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  assert.ok(res.ok, `${method} ${path} -> ${res.status} ${JSON.stringify(json)}`)
  return json
}

async function page(path) {
  const res = await fetch(`${STOREFRONT}${path}`)
  const html = await res.text()
  assert.equal(res.status, 200, `GET ${path} -> ${res.status}`)
  return html
}

test("backend health", async () => {
  const res = await fetch(`${BACKEND}/health`)
  assert.equal(await res.text(), "OK")
})

test("storefront renders home, listing, category and product pages", async () => {
  const home = await page(`/${COUNTRY}`)
  assert.match(home, /Featured/, "featured collection rail from store.config.ts")
  assert.match(home, /Essential Tee/)
  await page(`/${COUNTRY}/store`)
  assert.match(await page(`/${COUNTRY}/categories/home`), /Stoneware Mug/)
  const product = await page(`/${COUNTRY}/products/essential-tee`)
  assert.match(product, /Essential Tee/)
  assert.match(product, /25[.,]00/)
})

test("catalog exposes variants with EUR prices", async () => {
  const { regions } = await store("/store/regions")
  const region = regions.find((r) => r.countries.some((c) => c.iso_2 === COUNTRY))
  assert.ok(region, `a region contains ${COUNTRY}`)
  assert.equal(region.currency_code, "eur")
  const { products, count } = await store(
    `/store/products?region_id=${region.id}&fields=handle,*variants.calculated_price,variants.sku&limit=100`
  )
  assert.ok(count >= 8, `demo products present (${count})`)
  const tee = products.find((p) => p.handle === "essential-tee")
  assert.equal(tee.variants.length, 8)
  for (const v of tee.variants) {
    assert.equal(v.calculated_price.currency_code, "eur")
    assert.equal(v.calculated_price.calculated_amount, 25)
  }
})

test("cart operations and checkout with the test payment provider", async () => {
  const { regions } = await store("/store/regions")
  const region = regions.find((r) => r.countries.some((c) => c.iso_2 === COUNTRY))
  const { products } = await store(`/store/products?handle[]=essential-tee&handle[]=stoneware-mug&fields=handle,variants.id,variants.sku`)
  const variant = (sku) => products.flatMap((p) => p.variants).find((v) => v.sku === sku).id

  let { cart } = await store("/store/carts", { method: "POST", body: { region_id: region.id } })

  ;({ cart } = await store(`/store/carts/${cart.id}/line-items`, {
    method: "POST",
    body: { variant_id: variant("TEE-M-BLACK"), quantity: 1 },
  }))
  ;({ cart } = await store(`/store/carts/${cart.id}/line-items`, {
    method: "POST",
    body: { variant_id: variant("MUG-SAND"), quantity: 1 },
  }))
  assert.equal(cart.items.length, 2)

  const tee = cart.items.find((i) => i.variant_sku === "TEE-M-BLACK")
  ;({ cart } = await store(`/store/carts/${cart.id}/line-items/${tee.id}`, { method: "POST", body: { quantity: 2 } }))
  assert.equal(cart.items.find((i) => i.id === tee.id).quantity, 2)

  const mug = cart.items.find((i) => i.variant_sku === "MUG-SAND")
  const removed = await store(`/store/carts/${cart.id}/line-items/${mug.id}`, { method: "DELETE" })
  cart = removed.parent
  assert.equal(cart.items.length, 1)
  assert.equal(cart.item_total, 50)

  const address = {
    first_name: "Smoke",
    last_name: "Test",
    address_1: "Teststrasse 1",
    city: "Berlin",
    postal_code: "10115",
    country_code: COUNTRY,
  }
  ;({ cart } = await store(`/store/carts/${cart.id}`, {
    method: "POST",
    body: { email: "smoke-test@example.com", shipping_address: address, billing_address: address },
  }))

  const { shipping_options } = await store(`/store/shipping-options?cart_id=${cart.id}`)
  const standard = shipping_options.find((o) => o.type?.code === "standard") ?? shipping_options[0]
  assert.ok(standard, "a shipping option is available")
  ;({ cart } = await store(`/store/carts/${cart.id}/shipping-methods`, {
    method: "POST",
    body: { option_id: standard.id },
  }))

  const { payment_collection } = await store("/store/payment-collections", {
    method: "POST",
    body: { cart_id: cart.id },
  })
  await store(`/store/payment-collections/${payment_collection.id}/payment-sessions`, {
    method: "POST",
    body: { provider_id: "pp_system_default" },
  })

  const completed = await store(`/store/carts/${cart.id}/complete`, { method: "POST" })
  assert.equal(completed.type, "order", JSON.stringify(completed.error ?? completed))
  assert.equal(completed.order.items[0].quantity, 2)
  assert.equal(completed.order.total, 50 + standard.amount)
  console.log(`  order ${completed.order.display_id} total ${completed.order.total} ${completed.order.currency_code}`)
})
