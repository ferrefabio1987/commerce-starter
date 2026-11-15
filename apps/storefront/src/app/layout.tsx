import { getBaseURL } from "@lib/util/env"
import { themeCss } from "@lib/util/theme"
import { storeConfig } from "@store-config"
import { Metadata } from "next"
import "styles/globals.css"

export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
  applicationName: storeConfig.name,
  title: {
    template: `%s | ${storeConfig.name}`,
    default: storeConfig.name,
  },
  description: storeConfig.description,
  icons: { icon: storeConfig.favicon },
  openGraph: { siteName: storeConfig.name },
}

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" data-mode="light">
      <head>
        <link rel="ucp" href="/.well-known/ucp" />
        <style
          id="store-theme"
          dangerouslySetInnerHTML={{ __html: themeCss(storeConfig.theme) }}
        />
      </head>
      <body className="bg-ui-bg-base text-ui-fg-base font-sans">
        <main className="relative">{props.children}</main>
      </body>
    </html>
  )
}
