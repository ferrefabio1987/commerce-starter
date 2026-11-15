import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"
import type { MedusaContainer } from "@medusajs/framework/types"
import seed from "../../src/scripts/seed"

jest.setTimeout(240 * 1000)

const ENTITIES = [
  "region",
  "tax_region",
  "stock_location",
  "sales_channel",
  "shipping_option",
  "api_key",
  "product",
  "product_variant",
  "product_category",
  "product_collection",
  "inventory_item",
  "inventory_level",
] as const

async function countAll(container: MedusaContainer) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const counts: Record<string, number> = {}
  for (const entity of ENTITIES) {
    const { data } = await query.graph({ entity, fields: ["id"] })
    counts[entity] = data.length
  }
  return counts
}

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("seed script", () => {
      it("rejects a missing or unknown preset", async () => {
        await expect(seed({ container: getContainer(), args: [] })).rejects.toThrow(/preset/)
        await expect(seed({ container: getContainer(), args: ["bogus"] })).rejects.toThrow(/preset/)
      })

      it("minimal, then demo twice: idempotent and never overwrites merchant data", async () => {
        const container = getContainer()
        const query = container.resolve(ContainerRegistrationKeys.QUERY)

        await seed({ container, args: ["minimal"] })
        const minimal = await countAll(container)
        expect(minimal.product).toBe(0)
        expect(minimal.shipping_option).toBe(2)
        expect(minimal.region).toBe(1)

        const {
          data: [store],
        } = await query.graph({
          entity: "store",
          fields: ["name", "default_sales_channel_id", "default_region_id", "default_location_id"],
        })
        expect(store.name).toBe("My Store")
        expect(store.default_sales_channel_id).toBeTruthy()
        expect(store.default_region_id).toBeTruthy()
        expect(store.default_location_id).toBeTruthy()

        // Minimal again changes nothing.
        await seed({ container, args: ["minimal"] })
        expect(await countAll(container)).toEqual(minimal)

        await seed({ container, args: ["demo"] })
        const demo = await countAll(container)
        expect(demo.product).toBe(8)
        expect(demo.product_variant).toBe(22)
        expect(demo.product_category).toBe(3)
        expect(demo.product_collection).toBe(2)
        expect(demo.inventory_level).toBe(22)
        // Demo builds on minimal without duplicating it.
        for (const key of ["region", "tax_region", "stock_location", "sales_channel", "shipping_option", "api_key"]) {
          expect(demo[key]).toBe(minimal[key])
        }

        // A merchant edits a seeded product.
        const {
          data: [tee],
        } = await query.graph({ entity: "product", fields: ["id"], filters: { handle: "essential-tee" } })
        await updateProductsWorkflow(container).run({
          input: { selector: { id: tee.id }, update: { title: "Merchant Title" } },
        })

        await seed({ container, args: ["demo"] })
        expect(await countAll(container)).toEqual(demo)
        const {
          data: [teeAfter],
        } = await query.graph({ entity: "product", fields: ["title"], filters: { id: tee.id } })
        expect(teeAfter.title).toBe("Merchant Title")

        // Seeded catalog is sellable through the Store API with EUR prices.
        const { data: keys } = await query.graph({
          entity: "api_key",
          fields: ["token"],
          filters: { type: "publishable" },
        })
        const headers = { "x-publishable-api-key": keys[0].token }
        const { data: regions } = await api.get("/store/regions", { headers })
        expect(regions.regions[0].currency_code).toBe("eur")
        const { data: products } = await api.get(
          `/store/products?region_id=${regions.regions[0].id}&fields=*variants.calculated_price&limit=50`,
          { headers }
        )
        expect(products.count).toBe(8)
        for (const product of products.products) {
          for (const variant of product.variants) {
            expect(variant.calculated_price.calculated_amount).toBeGreaterThan(0)
            expect(variant.calculated_price.currency_code).toBe("eur")
          }
        }
        const { data: collections } = await api.get("/store/collections?handle[]=featured&handle[]=new-arrivals", {
          headers,
        })
        expect(collections.collections.map((c: { handle: string }) => c.handle).sort()).toEqual([
          "featured",
          "new-arrivals",
        ])
      })
    })
  },
})
