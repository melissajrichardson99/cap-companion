import { useState, type ComponentType } from 'react'
import { FOOD_TRUCKS } from '../foodTruckContent'
import { PAGE_SUBHEADERS } from '../pageSubheaderContent'
import { BurgerIcon, CoffeeCupIcon, ForkKnifeIcon, IceCreamIcon } from './NavIcons'
import './FoodTruckScreen.css'

// One ribbon icon per truck, keyed by slug -- not derived from content data
// since the icon is a visual choice (SVG component), not park copy.
const RIBBON_ICON: Record<string, ComponentType<{ className?: string }>> = {
  'granny-anns-kitchen': BurgerIcon,
  'sugar-shack': IceCreamIcon,
  'critter-cafe': CoffeeCupIcon,
}

// Same jpg->png->placeholder fallback chain as AnimalImage (animalContent.ts)
// -- walks the real-photo candidates on each load failure, landing on the
// truck's themed placeholder SVG only once every candidate has 404'd.
function FoodTruckPhoto({ candidates, placeholderSrc, alt }: { candidates: string[]; placeholderSrc: string; alt: string }) {
  const [attempt, setAttempt] = useState(0)
  const src = attempt < candidates.length ? candidates[attempt] : placeholderSrc

  return <img className="foodtruck-photo" src={src} alt={alt} onError={() => setAttempt((a) => a + 1)} />
}

export function FoodTruckScreen() {
  return (
    <div className="foodtruck-screen">
      <h1 className="cap-sign-board">
        <ForkKnifeIcon className="cap-sign-board-icon" />
        Food Truck Menus
      </h1>
      <p className="cap-page-subheader">{PAGE_SUBHEADERS.foodTrucks}</p>

      <div className="foodtruck-grid">
        {FOOD_TRUCKS.map((truck) => {
          const RibbonIcon = RIBBON_ICON[truck.slug]
          return (
            <section key={truck.slug} data-truck={truck.slug} className="foodtruck-card cap-parchment-card">
              <FoodTruckPhoto candidates={truck.photoCandidates} placeholderSrc={truck.photoPlaceholderSrc} alt={truck.name} />

              <div className="foodtruck-ribbon">
                <RibbonIcon className="foodtruck-ribbon-icon" />
                <div className="foodtruck-ribbon-text">
                  <span className="foodtruck-ribbon-name">{truck.name}</span>
                  <span className="foodtruck-ribbon-tagline">{truck.tagline}</span>
                </div>
                {truck.seasonal && <span className="foodtruck-seasonal-badge">Fall Only</span>}
              </div>

              <div className="foodtruck-body">
                {truck.menuItems.length > 0 && (
                  <ul className="foodtruck-menu-list">
                    {truck.menuItems.map((item) => (
                      <li key={item.name} className="foodtruck-menu-item">
                        <span className="foodtruck-menu-item-name">{item.name}</span>
                        {item.price && <span className="foodtruck-menu-item-price">{item.price}</span>}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="foodtruck-sideboxes">
                  {truck.sideBoxes.map((box) => (
                    <div key={box.title} className="foodtruck-sidebox">
                      <h3 className="foodtruck-sidebox-title">{box.title}</h3>
                      <ul className="foodtruck-sidebox-list">
                        {box.items.map((item) => (
                          <li key={item.name} className="foodtruck-menu-item">
                            <span className="foodtruck-menu-item-name">{item.name}</span>
                            {item.price && <span className="foodtruck-menu-item-price">{item.price}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )
        })}
      </div>

      <div className="foodtruck-note-bar cap-parchment-card">
        <p className="foodtruck-note-text">
          Please Note: Menu items and prices are subject to change. Thank you for supporting our food trucks!
        </p>
        <p className="cap-sign-board foodtruck-closing-sign">Thank You &amp; Enjoy Your Visit!</p>
      </div>
    </div>
  )
}
