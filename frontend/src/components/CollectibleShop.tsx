import type { CollectibleCatalogEntry, CoinsSummary } from '../api'
import { ANIMALS, imageCandidates } from '../animalContent'
import { AnimalImage } from './AnimalImage'
import './CollectibleShop.css'

interface CollectibleShopProps {
  catalog: CollectibleCatalogEntry[]
  coinsSummary: CoinsSummary | null
  onSelectAnimal: (entry: CollectibleCatalogEntry) => void
}

// Grid of the 9 purchasable animals -- ticket 3.1 ("A new 'shop' UI ...
// lists all 9 animals with their price and current coin balance, each with
// a 'Collect' button"). Price/tier come from the backend catalog
// (app/services/collectibles.py) so nothing here hardcodes them; display
// name/photo reuse the existing Our Animals roster (animalContent.ts) --
// same slug, same photo path convention -- rather than duplicating either.
export function CollectibleShop({ catalog, coinsSummary, onSelectAnimal }: CollectibleShopProps) {
  const coinTotal = coinsSummary?.total ?? 0

  return (
    <div className="collectible-shop">
      <div className="collectible-shop-balance">🪙 {coinTotal} Cobb Coins</div>
      <div className="collectible-shop-grid">
        {catalog.map((entry) => {
          const animal = ANIMALS.find((a) => a.slug === entry.animal_slug)
          const name = animal?.name ?? entry.animal_slug
          const affordable = coinTotal >= entry.price
          return (
            <div key={entry.animal_slug} className="collectible-shop-card cap-parchment-card">
              <AnimalImage
                candidates={imageCandidates(entry.animal_slug, 1)}
                alt={`${name} photo`}
                className="collectible-shop-card-photo"
              />
              <span className="collectible-shop-card-name">{name}</span>
              {entry.tier === 'special' && <span className="collectible-shop-card-special-badge">Special</span>}
              <span className="collectible-shop-card-price">🪙 {entry.price}</span>
              <button
                type="button"
                className="btn btn-primary collectible-shop-card-btn"
                disabled={!affordable}
                onClick={() => onSelectAnimal(entry)}
              >
                Collect
              </button>
              {!affordable && (
                <p className="collectible-shop-card-insufficient">Not enough coins yet</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
