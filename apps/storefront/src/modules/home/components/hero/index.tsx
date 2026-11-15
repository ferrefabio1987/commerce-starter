import { Button, Heading } from "@modules/common/components/ui"
import LocalizedClientLink from "@modules/common/components/localized-client-link"
import { storeConfig } from "@store-config"

const Hero = () => {
  const { title, subtitle, cta } = storeConfig.home.hero
  return (
    <div className="h-[60vh] w-full border-b border-ui-border-base relative bg-ui-bg-subtle">
      <div className="absolute inset-0 z-10 flex flex-col justify-center items-center text-center p-6 small:p-32 gap-6">
        <span>
          <Heading level="h1" className="text-3xl leading-10 text-ui-fg-base font-normal">
            {title}
          </Heading>
          <Heading level="h2" className="text-3xl leading-10 text-ui-fg-subtle font-normal">
            {subtitle}
          </Heading>
        </span>
        {cta && (
          <LocalizedClientLink href={cta.href}>
            <Button variant="primary" size="large">
              {cta.label}
            </Button>
          </LocalizedClientLink>
        )}
      </div>
    </div>
  )
}

export default Hero
