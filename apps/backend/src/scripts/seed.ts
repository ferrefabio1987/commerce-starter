/**
 * Idempotent seed with two presets:
 *
 *   minimal  store settings, region, taxes, sales channel, stock location,
 *            fulfillment, shipping options and the storefront publishable key
 *   demo     minimal + categories, collections, products, prices, inventory
 *
 *   npm run seed -- --preset=minimal|demo        (from the repo root)
 *   medusa exec ./src/scripts/seed.ts <preset>   (from apps/backend)
 *
 * Data lives in JSON under SEEDS_DIR (default: <repo>/seeds). Every record is
 * matched on an identifier Medusa enforces as unique (handle, SKU, country) or
 * one this seed owns (store defaults, region metadata.seed_key, shipping option
 * type code inside the seeded service zone). Missing records are created through
 * core-flows workflows; existing records are never modified.
 */
import fs from "fs"
import path from "path"
import { z } from "@medusajs/framework/zod"
import type { ExecArgs, MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createCollectionsWorkflow,
  createInventoryLevelsWorkflow,
  createLocationFulfillmentSetWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createServiceZonesWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
  uploadFilesWorkflow,
} from "@medusajs/medusa/core-flows"

const PRESETS = ["minimal", "demo"] as const
type Preset = (typeof PRESETS)[number]

// Name Medusa gives the store it creates on first boot. Only this name is
// replaced by the configured one, so a merchant's own store name is kept.
const MEDUSA_DEFAULT_STORE_NAMES = ["Medusa Store", "Default Store"]

const StoreSeed = z.object({
  store: z.object({
    name: z.string().min(1),
    currencies: z.array(z.string().length(3)).min(1),
  }),
  salesChannel: z.object({ name: z.string().min(1), description: z.string().optional() }),
  region: z.object({
    key: z.string().min(1),
    name: z.string().min(1),
    currency: z.string().length(3),
    countries: z.array(z.string().length(2)).min(1),
    paymentProviders: z.array(z.string()).min(1),
    automaticTaxes: z.boolean(),
    policies: z.record(z.string(), z.union([z.number(), z.boolean()])),
  }),
  taxProvider: z.string().min(1),
  stockLocation: z.object({
    name: z.string().min(1),
    address: z.object({
      address_1: z.string(),
      city: z.string(),
      country_code: z.string().length(2),
    }),
  }),
  fulfillment: z.object({
    provider: z.string().min(1),
    setName: z.string().min(1),
    serviceZoneName: z.string().min(1),
  }),
  shippingOptions: z
    .array(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1),
        label: z.string().min(1),
        description: z.string(),
        amount: z.number().nonnegative(),
      })
    )
    .min(1),
  publishableKey: z.object({ title: z.string().min(1) }),
})

const Categories = z.array(
  z.object({ handle: z.string().min(1), name: z.string().min(1), description: z.string().optional() })
)
const Collections = z.array(z.object({ handle: z.string().min(1), title: z.string().min(1) }))
const Products = z.array(
  z.object({
    handle: z.string().min(1),
    title: z.string().min(1),
    description: z.string(),
    category: z.string().optional(),
    collection: z.string().optional(),
    weight: z.number().optional(),
    images: z.array(z.string()).default([]),
    options: z.array(z.object({ title: z.string(), values: z.array(z.string()).min(1) })).min(1),
    variants: z
      .array(
        z.object({
          sku: z.string().min(1),
          options: z.record(z.string(), z.string()),
          price: z.number().nonnegative(),
          inventory: z.number().int().nonnegative(),
        })
      )
      .min(1),
  })
)

export function parsePreset(args: string[] = []): Preset {
  const raw = args.find((a) => a.trim().length)?.replace(/^(--)?preset=/, "")
  if (!raw || !(PRESETS as readonly string[]).includes(raw)) {
    throw new Error(
      `Unknown or missing seed preset "${raw ?? ""}". Use one of: ${PRESETS.join(", ")}.\n` +
        "  Example: npm run seed -- --preset=demo"
    )
  }
  return raw as Preset
}

function seedsDir() {
  return path.resolve(process.env.SEEDS_DIR || path.join(process.cwd(), "../../seeds"))
}

function readJson<T>(schema: z.ZodType<T>, file: string): T {
  const full = path.join(seedsDir(), file)
  if (!fs.existsSync(full)) {
    throw new Error(`Seed file not found: ${full} (set SEEDS_DIR to the seeds directory)`)
  }
  const result = schema.safeParse(JSON.parse(fs.readFileSync(full, "utf8")))
  if (!result.success) {
    throw new Error(`Invalid seed file ${full}:\n${z.prettifyError(result.error)}`)
  }
  return result.data
}

type Counter = Record<string, { created: number; skipped: number }>

export default async function seed({ container, args }: ExecArgs) {
  const preset = parsePreset(args)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const counts: Counter = {}

  logger.info(`Seeding preset "${preset}" from ${seedsDir()}`)
  const base = await seedMinimal(container, counts)
  if (preset === "demo") {
    await seedDemo(container, counts, base)
  }

  for (const [entity, { created, skipped }] of Object.entries(counts)) {
    logger.info(`  ${entity.padEnd(18)} created ${created}, existing ${skipped}`)
  }
  logger.info(`Publishable API key: ${base.publishableKey}`)
  writePublishableKeyToEnv(base.publishableKey, logger)
  logger.info(`Seed "${preset}" finished.`)
}

function tally(counts: Counter, entity: string, created: number, skipped: number) {
  const c = (counts[entity] ??= { created: 0, skipped: 0 })
  c.created += created
  c.skipped += skipped
}

type MinimalResult = {
  salesChannelId: string
  regionId: string
  stockLocationId: string
  shippingProfileId: string
  publishableKey: string
}

async function seedMinimal(container: MedusaContainer, counts: Counter): Promise<MinimalResult> {
  const cfg = readJson(StoreSeed, "minimal/store.json")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  // Store (singleton in a single-store deployment)
  const storeFields = [
    "id",
    "name",
    "default_sales_channel_id",
    "default_region_id",
    "default_location_id",
    "supported_currencies.currency_code",
    "supported_currencies.is_default",
  ]
  let {
    data: [store],
  } = await query.graph({ entity: "store", fields: storeFields })
  if (!store) {
    await createStoresWorkflow(container).run({
      input: {
        stores: [
          {
            name: cfg.store.name,
            supported_currencies: cfg.store.currencies.map((code, i) => ({
              currency_code: code,
              is_default: i === 0,
            })),
          },
        ],
      },
    })
    ;({
      data: [store],
    } = await query.graph({ entity: "store", fields: storeFields }))
    tally(counts, "store", 1, 0)
  } else {
    const existing = (store.supported_currencies ?? []).filter(Boolean) as {
      currency_code: string
      is_default: boolean
    }[]
    const missing = cfg.store.currencies.filter(
      (code) => !existing.some((c) => c.currency_code === code)
    )
    const rename = MEDUSA_DEFAULT_STORE_NAMES.includes(store.name)
    if (missing.length || rename) {
      const hasDefault = existing.some((c) => c.is_default)
      await updateStoresWorkflow(container).run({
        input: {
          selector: { id: store.id },
          update: {
            ...(rename ? { name: cfg.store.name } : {}),
            supported_currencies: [
              ...existing.map((c) => ({ currency_code: c.currency_code, is_default: c.is_default })),
              ...missing.map((code, i) => ({ currency_code: code, is_default: !hasDefault && i === 0 })),
            ],
          },
        },
      })
    }
    tally(counts, "store", 0, 1)
  }

  const setStoreDefaults = async (update: Record<string, string>) => {
    await updateStoresWorkflow(container).run({ input: { selector: { id: store.id }, update } })
  }

  // Sales channel: the store's default one
  let salesChannelId = store.default_sales_channel_id as string | null
  if (salesChannelId) {
    tally(counts, "sales channel", 0, 1)
  } else {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: { salesChannelsData: [cfg.salesChannel] },
    })
    salesChannelId = result[0].id
    await setStoreDefaults({ default_sales_channel_id: salesChannelId })
    tally(counts, "sales channel", 1, 0)
  }

  // Region: owned via metadata.seed_key; otherwise reuse whichever region
  // already covers the first configured country (countries are unique per region).
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "metadata", "countries.iso_2"],
  })
  let regionId = (
    regions.find((r) => r.metadata?.seed_key === cfg.region.key) ??
    regions.find((r) => r.countries?.some((c) => c?.iso_2 === cfg.region.countries[0]))
  )?.id
  if (regionId) {
    tally(counts, "region", 0, 1)
  } else {
    const taken = regions.flatMap((r) => (r.countries ?? []).map((c) => c?.iso_2))
    const conflicts = cfg.region.countries.filter((c) => taken.includes(c))
    if (conflicts.length) {
      throw new Error(
        `Cannot create region "${cfg.region.name}": countries ${conflicts.join(", ")} already belong to another region. ` +
          "Adjust seeds/minimal/store.json or the existing regions in Medusa Admin."
      )
    }
    const { result } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: cfg.region.name,
            currency_code: cfg.region.currency,
            countries: cfg.region.countries,
            payment_providers: cfg.region.paymentProviders,
            automatic_taxes: cfg.region.automaticTaxes,
            metadata: { seed_key: cfg.region.key, ...cfg.region.policies },
          },
        ],
      },
    })
    regionId = result[0].id
    tally(counts, "region", 1, 0)
  }
  if (!store.default_region_id) {
    await setStoreDefaults({ default_region_id: regionId })
  }

  // Tax regions: one per country (country-level tax regions are unique)
  const { data: taxRegions } = await query.graph({
    entity: "tax_region",
    fields: ["id", "country_code", "parent_id"],
  })
  const missingTax = cfg.region.countries.filter(
    (cc) => !taxRegions.some((t) => t.country_code === cc && !t.parent_id)
  )
  if (missingTax.length) {
    await createTaxRegionsWorkflow(container).run({
      input: missingTax.map((country_code) => ({ country_code, provider_id: cfg.taxProvider })),
    })
  }
  tally(counts, "tax region", missingTax.length, cfg.region.countries.length - missingTax.length)

  // Stock location: the store's default one
  let stockLocationId = store.default_location_id as string | null
  if (stockLocationId) {
    tally(counts, "stock location", 0, 1)
  } else {
    const { result } = await createStockLocationsWorkflow(container).run({
      input: { locations: [cfg.stockLocation] },
    })
    stockLocationId = result[0].id
    await setStoreDefaults({ default_location_id: stockLocationId })
    tally(counts, "stock location", 1, 0)
  }

  const locationFields = [
    "id",
    "fulfillment_providers.id",
    "sales_channels.id",
    "fulfillment_sets.id",
    "fulfillment_sets.type",
    "fulfillment_sets.service_zones.id",
  ]
  const getLocation = async () =>
    (
      await query.graph({
        entity: "stock_location",
        fields: locationFields,
        filters: { id: stockLocationId! },
      })
    ).data[0]
  let location = await getLocation()
  if (!location) {
    throw new Error(`Store default stock location ${stockLocationId} no longer exists.`)
  }

  if (!location.fulfillment_providers?.some((p) => p?.id === cfg.fulfillment.provider)) {
    await link.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocationId },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: cfg.fulfillment.provider },
    })
  }
  if (!location.sales_channels?.some((s) => s?.id === salesChannelId)) {
    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: { id: stockLocationId, add: [salesChannelId] },
    })
  }

  // Fulfillment set + service zone attached to the seeded location
  let fulfillmentSet = location.fulfillment_sets?.find((f) => f?.type === "shipping")
  if (!fulfillmentSet) {
    await createLocationFulfillmentSetWorkflow(container).run({
      input: {
        location_id: stockLocationId,
        fulfillment_set_data: { name: cfg.fulfillment.setName, type: "shipping" },
      },
    })
    location = await getLocation()
    fulfillmentSet = location.fulfillment_sets?.find((f) => f?.type === "shipping")
    tally(counts, "fulfillment set", 1, 0)
  } else {
    tally(counts, "fulfillment set", 0, 1)
  }
  let serviceZoneId = fulfillmentSet?.service_zones?.[0]?.id
  if (!serviceZoneId) {
    const { result } = await createServiceZonesWorkflow(container).run({
      input: {
        data: [
          {
            fulfillment_set_id: fulfillmentSet!.id,
            name: cfg.fulfillment.serviceZoneName,
            geo_zones: cfg.region.countries.map((country_code) => ({
              type: "country" as const,
              country_code,
            })),
          },
        ],
      },
    })
    serviceZoneId = result[0].id
    tally(counts, "service zone", 1, 0)
  } else {
    tally(counts, "service zone", 0, 1)
  }

  // Shipping profile: Medusa's default profile
  const { data: profiles } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
    filters: { type: "default" },
  })
  let shippingProfileId = profiles[0]?.id
  if (!shippingProfileId) {
    const { result } = await createShippingProfilesWorkflow(container).run({
      input: { data: [{ name: "Default Shipping Profile", type: "default" }] },
    })
    shippingProfileId = result[0].id
    tally(counts, "shipping profile", 1, 0)
  } else {
    tally(counts, "shipping profile", 0, 1)
  }

  // Shipping options: matched by type code inside the seeded service zone
  const { data: options } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "type.code"],
    filters: { service_zone_id: serviceZoneId },
  })
  const missingOptions = cfg.shippingOptions.filter(
    (o) => !options.some((existing) => existing.type?.code === o.key)
  )
  if (missingOptions.length) {
    await createShippingOptionsWorkflow(container).run({
      input: missingOptions.map((o) => ({
        name: o.name,
        price_type: "flat" as const,
        provider_id: cfg.fulfillment.provider,
        service_zone_id: serviceZoneId!,
        shipping_profile_id: shippingProfileId!,
        type: { label: o.label, description: o.description, code: o.key },
        prices: [
          { currency_code: cfg.region.currency, amount: o.amount },
          { region_id: regionId, amount: o.amount },
        ],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" as const },
          { attribute: "is_return", value: "false", operator: "eq" as const },
        ],
      })),
    })
  }
  tally(counts, "shipping option", missingOptions.length, cfg.shippingOptions.length - missingOptions.length)

  // Publishable key: any active publishable key already scoped to the sales channel
  const { data: keys } = await query.graph({
    entity: "api_key",
    fields: ["id", "token", "revoked_at", "sales_channels.id"],
    filters: { type: "publishable" },
  })
  let publishableKey = keys.find(
    (k) => !k.revoked_at && k.sales_channels?.some((s) => s?.id === salesChannelId)
  )?.token
  if (publishableKey) {
    tally(counts, "publishable key", 0, 1)
  } else {
    const { result } = await createApiKeysWorkflow(container).run({
      input: { api_keys: [{ title: cfg.publishableKey.title, type: "publishable", created_by: "" }] },
    })
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: { id: result[0].id, add: [salesChannelId] },
    })
    publishableKey = result[0].token
    tally(counts, "publishable key", 1, 0)
  }

  logger.info("Minimal commerce configuration is in place.")
  return {
    salesChannelId,
    regionId,
    stockLocationId,
    shippingProfileId: shippingProfileId!,
    publishableKey,
  }
}

async function seedDemo(container: MedusaContainer, counts: Counter, base: MinimalResult) {
  const categories = readJson(Categories, "demo/categories.json")
  const collections = readJson(Collections, "demo/collections.json")
  const products = readJson(Products, "demo/products.json")
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  // Categories by handle
  const { data: existingCategories } = await query.graph({
    entity: "product_category",
    fields: ["id", "handle"],
    filters: { handle: categories.map((c) => c.handle) },
  })
  const newCategories = categories.filter((c) => !existingCategories.some((e) => e.handle === c.handle))
  if (newCategories.length) {
    await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: newCategories.map((c) => ({ ...c, is_active: true, is_internal: false })),
      },
    })
  }
  tally(counts, "category", newCategories.length, categories.length - newCategories.length)

  // Collections by handle
  const { data: existingCollections } = await query.graph({
    entity: "product_collection",
    fields: ["id", "handle"],
    filters: { handle: collections.map((c) => c.handle) },
  })
  const newCollections = collections.filter((c) => !existingCollections.some((e) => e.handle === c.handle))
  if (newCollections.length) {
    await createCollectionsWorkflow(container).run({ input: { collections: newCollections } })
  }
  tally(counts, "collection", newCollections.length, collections.length - newCollections.length)

  const idByHandle = async (entity: "product_category" | "product_collection", handles: string[]) => {
    const { data } = await query.graph({ entity, fields: ["id", "handle"], filters: { handle: handles } })
    return new Map(data.map((d) => [d.handle as string, d.id as string] as const))
  }
  const categoryIds = await idByHandle("product_category", categories.map((c) => c.handle))
  const collectionIds = await idByHandle("product_collection", collections.map((c) => c.handle))

  // Products by handle; variants by SKU
  const { data: existingProducts } = await query.graph({
    entity: "product",
    fields: ["id", "handle"],
    filters: { handle: products.map((p) => p.handle) },
  })
  const newProducts = products.filter((p) => !existingProducts.some((e) => e.handle === p.handle))
  tally(counts, "product", newProducts.length, products.length - newProducts.length)

  if (newProducts.length) {
    const skus = newProducts.flatMap((p) => p.variants.map((v) => v.sku))
    const { data: takenSkus } = await query.graph({
      entity: "product_variant",
      fields: ["sku"],
      filters: { sku: skus },
    })
    if (takenSkus.length) {
      throw new Error(
        `SKUs already used by other products: ${takenSkus.map((v) => v.sku).join(", ")}. ` +
          "Rename them in seeds/demo/products.json or remove the conflicting variants."
      )
    }
    for (const p of newProducts) {
      if (p.category && !categoryIds.has(p.category)) {
        throw new Error(`Product "${p.handle}" references unknown category "${p.category}".`)
      }
      if (p.collection && !collectionIds.has(p.collection)) {
        throw new Error(`Product "${p.handle}" references unknown collection "${p.collection}".`)
      }
    }

    const urls = await uploadImages(container, [...new Set(newProducts.flatMap((p) => p.images))])

    const { result: created } = await createProductsWorkflow(container).run({
      input: {
        products: newProducts.map((p) => ({
          title: p.title,
          handle: p.handle,
          description: p.description,
          status: ProductStatus.PUBLISHED,
          weight: p.weight,
          shipping_profile_id: base.shippingProfileId,
          sales_channels: [{ id: base.salesChannelId }],
          category_ids: p.category ? [categoryIds.get(p.category)!] : [],
          collection_id: p.collection ? collectionIds.get(p.collection) : undefined,
          thumbnail: p.images[0] ? urls.get(p.images[0]) : undefined,
          images: p.images.map((img) => ({ url: urls.get(img)! })),
          options: p.options,
          variants: p.variants.map((v) => ({
            title: p.options.map((o) => v.options[o.title]).join(" / "),
            sku: v.sku,
            options: v.options,
            manage_inventory: true,
            prices: [{ amount: v.price, currency_code: "eur" }],
          })),
        })),
      },
    })

    // Index the new products now: events from this short-lived process may
    // not be consumed before it exits. Ingestion upserts, so repeats are safe.
    try {
      await container.resolve(Modules.SEARCH).ingest({
        name: "product.created",
        data: created.map((p) => ({ id: p.id })),
      } as never)
    } catch (e) {
      // Before `medusa db:migrate` has built the index there is nothing to
      // ingest into; the worker seeds the whole index once it exists.
      if (!/no active version/i.test((e as Error).message)) {
        throw e
      }
      logger.warn("Search index not migrated yet; products are indexed when the worker seeds it.")
    }
  }
  const variantCount = (list: typeof products) => list.reduce((n, p) => n + p.variants.length, 0)
  tally(counts, "variant", variantCount(newProducts), variantCount(products) - variantCount(newProducts))

  // Inventory levels at the seeded location, only where none exists yet
  const quantityBySku = new Map(products.flatMap((p) => p.variants.map((v) => [v.sku, v.inventory] as const)))
  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku", "location_levels.location_id"],
    filters: { sku: [...quantityBySku.keys()] },
  })
  const missingLevels = items.filter(
    (item) => !item.location_levels?.some((l) => l?.location_id === base.stockLocationId)
  )
  if (missingLevels.length) {
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: missingLevels.map((item) => ({
          inventory_item_id: item.id,
          location_id: base.stockLocationId,
          stocked_quantity: quantityBySku.get(item.sku as string) ?? 0,
        })),
      },
    })
  }
  tally(counts, "inventory level", missingLevels.length, items.length - missingLevels.length)

  logger.info("Demo catalog is in place.")
}

async function uploadImages(container: MedusaContainer, files: string[]) {
  const urls = new Map<string, string>()
  if (!files.length) {
    return urls
  }
  const dir = path.join(seedsDir(), "demo/assets")
  const { result } = await uploadFilesWorkflow(container).run({
    input: {
      files: files.map((filename) => {
        const full = path.join(dir, filename)
        if (!fs.existsSync(full)) {
          throw new Error(`Demo image not found: ${full}`)
        }
        return {
          filename,
          mimeType: filename.endsWith(".png") ? "image/png" : "image/jpeg",
          content: fs.readFileSync(full).toString("base64"),
          access: "public" as const,
        }
      }),
    },
  })
  files.forEach((name, i) => urls.set(name, result[i].url))
  return urls
}

// Local convenience: fill NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY in the repo-root
// .env when it is present and still empty. Never overwrites a value.
function writePublishableKeyToEnv(token: string, logger: { info: (m: string) => void }) {
  const envFile = path.resolve(seedsDir(), "../.env")
  if (process.env.NODE_ENV === "test" || !fs.existsSync(envFile)) {
    return
  }
  const content = fs.readFileSync(envFile, "utf8")
  const pattern = /^NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=\s*$/m
  if (pattern.test(content)) {
    fs.writeFileSync(envFile, content.replace(pattern, `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=${token}`))
    logger.info(`Wrote NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY to ${envFile}`)
  }
}
