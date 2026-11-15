/**
 * Storefront presentation config: branding, theme, layout, homepage, SEO and
 * feature flags. Edit this file (and public/brand/) to white-label the store.
 *
 * Commerce data does NOT live here. Products, prices, inventory, regions,
 * shipping and payments are managed in Medusa (Admin or seed). Homepage
 * collections are referenced by handle and resolved against Medusa at runtime.
 */

type Link = { label: string; href: string }

export type StoreConfig = {
  /** Used in the header (without a logo), page titles ("Page | Name"), footer and structured data. */
  name: string
  /** Default meta description and footer tagline. */
  description: string
  /** Logo shown in the header. `null` renders the store name as text. */
  logo: { src: string; alt: string; width: number; height: number } | null
  favicon: string
  theme: {
    colors: {
      /** Buttons, links and focus rings. */
      primary: string
      primaryForeground: string
      /** Secondary buttons and subtle surfaces (hero, cards). */
      secondary: string
      secondaryForeground: string
      background: string
      foreground: string
      muted: string
      border: string
    }
    /** CSS font-family stack. Load web fonts in src/app/layout.tsx if needed. */
    fontFamily: string
    /** Base corner radius (buttons, inputs, cards), e.g. "0px", "6px", "12px". */
    radius: string
  }
  home: {
    hero: {
      title: string
      subtitle: string
      cta: Link | null
    }
    /** Medusa collection handles, rendered as product rails in this order. */
    featuredCollections: string[]
  }
  nav: {
    links: Link[]
  }
  footer: {
    /** Extra link columns; product categories and collections are listed automatically. */
    columns: { title: string; links: Link[] }[]
    showCategories: boolean
    showCollections: boolean
  }
  features: {
    search: boolean
    customerAccounts: boolean
    countrySelect: boolean
  }
}

export const storeConfig: StoreConfig = {
  name: "Your Store",
  description: "Thoughtfully made goods for everyday use.",
  logo: null,
  favicon: "/favicon.ico",
  theme: {
    colors: {
      primary: "#18181b",
      primaryForeground: "#ffffff",
      secondary: "#f4f4f5",
      secondaryForeground: "#18181b",
      background: "#ffffff",
      foreground: "#18181b",
      muted: "#71717a",
      border: "#e4e4e7",
    },
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    radius: "6px",
  },
  home: {
    hero: {
      title: "Thoughtfully made goods",
      subtitle: "Everyday essentials, delivered to your door.",
      cta: { label: "Shop all products", href: "/store" },
    },
    featuredCollections: ["featured", "new-arrivals"],
  },
  nav: {
    links: [{ label: "Shop", href: "/store" }],
  },
  footer: {
    columns: [
      {
        title: "Help",
        links: [
          { label: "Shipping", href: "/shipping" },
          { label: "Returns", href: "/returns" },
          { label: "Contact", href: "/contact" },
        ],
      },
      {
        title: "Legal",
        links: [
          { label: "Privacy", href: "/privacy" },
          { label: "Terms", href: "/terms" },
        ],
      },
    ],
    showCategories: true,
    showCollections: true,
  },
  features: {
    search: true,
    customerAccounts: true,
    countrySelect: true,
  },
}
