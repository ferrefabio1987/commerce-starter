import { listCategories } from "@lib/data/categories"
import { listCollections } from "@lib/data/collections"
import { Text } from "@modules/common/components/ui"
import { storeConfig } from "@store-config"

import LocalizedClientLink from "@modules/common/components/localized-client-link"
import StoreLogo from "@modules/layout/components/store-logo"

type FooterLink = { label: string; href: string }

function FooterColumn({ title, links, testId }: { title: string; links: FooterLink[]; testId?: string }) {
  return (
    <div className="flex flex-col gap-y-2">
      <span className="txt-small-plus text-ui-fg-base">{title}</span>
      <ul className="grid grid-cols-1 gap-y-2 text-ui-fg-subtle txt-small" data-testid={testId}>
        {links.map((link) => (
          <li key={link.href}>
            <LocalizedClientLink className="hover:text-ui-fg-base" href={link.href}>
              {link.label}
            </LocalizedClientLink>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default async function Footer() {
  const { footer, name, description } = storeConfig
  const [{ collections }, productCategories] = await Promise.all([
    footer.showCollections ? listCollections({ fields: "id,handle,title" }) : { collections: [] },
    footer.showCategories ? listCategories({ fields: "id,name,handle,parent_category_id" }) : [],
  ])

  const categoryLinks = (productCategories ?? [])
    .filter((c) => !c.parent_category_id)
    .slice(0, 6)
    .map((c) => ({ label: c.name, href: `/categories/${c.handle}` }))
  const collectionLinks = (collections ?? [])
    .slice(0, 6)
    .map((c) => ({ label: c.title, href: `/collections/${c.handle}` }))

  return (
    <footer className="border-t border-ui-border-base w-full">
      <div className="content-container flex flex-col w-full">
        <div className="flex flex-col gap-y-10 small:flex-row items-start justify-between py-24">
          <div className="flex flex-col gap-y-3 max-w-xs">
            <LocalizedClientLink
              href="/"
              className="txt-compact-xlarge-plus text-ui-fg-subtle hover:text-ui-fg-base uppercase"
            >
              <StoreLogo />
            </LocalizedClientLink>
            <Text className="txt-small text-ui-fg-subtle">{description}</Text>
          </div>
          <div className="text-small-regular gap-10 md:gap-x-16 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4">
            {categoryLinks.length > 0 && (
              <FooterColumn title="Categories" links={categoryLinks} testId="footer-categories" />
            )}
            {collectionLinks.length > 0 && <FooterColumn title="Collections" links={collectionLinks} />}
            {footer.columns.map((column) => (
              <FooterColumn key={column.title} title={column.title} links={column.links} />
            ))}
          </div>
        </div>
        <div className="flex w-full mb-16 justify-between text-ui-fg-muted">
          <Text className="txt-compact-small">
            © {new Date().getFullYear()} {name}. All rights reserved.
          </Text>
        </div>
      </div>
    </footer>
  )
}
