import logo from '../assets/COBBS-logo_Colour-on-dark.png'

interface BrandLogoProps {
  onClick?: () => void
}

export function BrandLogo({ onClick }: BrandLogoProps) {
  const image = <img className="brand-logo" src={logo} alt="Cobb's Adventure Park" />

  if (!onClick) return image

  return (
    <button type="button" className="brand-logo-button" onClick={onClick} aria-label="Go to home page">
      {image}
    </button>
  )
}
