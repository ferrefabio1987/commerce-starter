import { storeConfig } from "@store-config"

/** Configured logo, or the store name when no logo is set. */
export default function StoreLogo() {
  const { logo, name } = storeConfig
  if (!logo) {
    return <>{name}</>
  }
  return (
    // Plain <img>: any format (SVG included) without image-optimizer config.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logo.src} alt={logo.alt} width={logo.width} height={logo.height} className="h-8 w-auto" />
  )
}
