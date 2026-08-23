import { useState } from 'react'
import type { CollectibleCard, CollectibleCatalogEntry, CoinsSummary } from '../api'
import { PAGE_SUBHEADERS } from '../pageSubheaderContent'
import { CollectibleGallery } from './CollectibleGallery'
import { CollectiblePurchaseModal } from './CollectiblePurchaseModal'
import { CollectibleShop } from './CollectibleShop'
import { PawIcon } from './NavIcons'
import './CollectiblesScreen.css'

interface CollectiblesScreenProps {
  catalog: CollectibleCatalogEntry[] | null
  catalogError: string | null
  onReloadCatalog: () => void
  cards: CollectibleCard[] | null
  cardsError: string | null
  onReloadCards: () => void
  coinsSummary: CoinsSummary | null
  onPurchase: (animalSlug: string, guestName: string) => Promise<CollectibleCard>
}

type SubTab = 'shop' | 'gallery'

// Repurposes the former badge-unlock "Collectibles" nav tab (same slot,
// same PawIcon) for the Cobb Coins spend feature -- Card Shop + Your
// Collection gallery -- rather than adding a second top-level nav entry.
export function CollectiblesScreen({
  catalog,
  catalogError,
  onReloadCatalog,
  cards,
  cardsError,
  onReloadCards,
  coinsSummary,
  onPurchase,
}: CollectiblesScreenProps) {
  const [subTab, setSubTab] = useState<SubTab>('shop')
  const [purchasing, setPurchasing] = useState<CollectibleCatalogEntry | null>(null)

  const error = catalogError ?? cardsError
  if (error) {
    return (
      <div className="collectibles-screen">
        <p className="screen-error">Couldn't load Collectible Cards: {error}</p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            onReloadCatalog()
            onReloadCards()
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  if (!catalog || !cards) {
    return <div className="collectibles-screen collectibles-loading">Loading Collectible Cards…</div>
  }

  return (
    <div className="collectibles-screen">
      <h1 className="cap-sign-board">
        <PawIcon className="cap-sign-board-icon" />
        Collectibles
      </h1>
      <p className="cap-page-subheader">{PAGE_SUBHEADERS.collectibles}</p>

      <div className="collectibles-sub-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'shop'}
          className={`collectibles-sub-tab${subTab === 'shop' ? ' collectibles-sub-tab-active' : ''}`}
          onClick={() => setSubTab('shop')}
        >
          Card Shop
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'gallery'}
          className={`collectibles-sub-tab${subTab === 'gallery' ? ' collectibles-sub-tab-active' : ''}`}
          onClick={() => setSubTab('gallery')}
        >
          Your Collection ({cards.length})
        </button>
      </div>

      {subTab === 'shop' ? (
        <CollectibleShop catalog={catalog} coinsSummary={coinsSummary} onSelectAnimal={setPurchasing} />
      ) : (
        <CollectibleGallery cards={cards} />
      )}

      {purchasing && (
        <CollectiblePurchaseModal entry={purchasing} onClose={() => setPurchasing(null)} onPurchase={onPurchase} />
      )}
    </div>
  )
}
