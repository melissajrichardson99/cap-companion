import { useRef, useState, type FormEvent } from 'react'
import type { CollectibleCard, CollectibleCatalogEntry } from '../api'
import { ANIMALS } from '../animalContent'
import { canShareFiles, cardFilename, downloadCard, shareCard } from '../collectibleCardImage'
import { CollectibleCardVisual } from './CollectibleCardVisual'
import { Modal } from './Modal'
import { PawIcon } from './NavIcons'
import './CollectiblePurchaseModal.css'

interface CollectiblePurchaseModalProps {
  entry: CollectibleCatalogEntry
  onClose: () => void
  onPurchase: (animalSlug: string, guestName: string) => Promise<CollectibleCard>
}

type Step = 'name' | 'revealing' | 'reveal'

// Two-step purchase flow: name prompt, then the "reveal" moment (ticket
// 3.2/4) showing the finished card with Download/Share. Each purchase gets
// its own prompt+reveal instance -- this modal is mounted fresh per
// purchase (see CollectiblesScreen.tsx), so there's no risk of a name
// carrying over between different family members' cards.
export function CollectiblePurchaseModal({ entry, onClose, onPurchase }: CollectiblePurchaseModalProps) {
  const [step, setStep] = useState<Step>('name')
  const [guestName, setGuestName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [card, setCard] = useState<CollectibleCard | null>(null)
  const [shareBusy, setShareBusy] = useState(false)
  const [shareResult, setShareResult] = useState<'shared' | 'downloaded' | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  const animal = ANIMALS.find((a) => a.slug === entry.animal_slug)
  const animalName = animal?.name ?? entry.animal_slug

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = guestName.trim()
    if (!trimmed) {
      setError('Enter a name for this card.')
      return
    }
    setError(null)
    setStep('revealing')
    try {
      const purchased = await onPurchase(entry.animal_slug, trimmed)
      setCard(purchased)
      setStep('reveal')
    } catch (err) {
      setError(String(err))
      setStep('name')
    }
  }

  const handleDownload = async () => {
    if (!cardRef.current) return
    await downloadCard(cardRef.current, cardFilename(animalName, guestName))
  }

  const handleShare = async () => {
    if (!cardRef.current) return
    setShareBusy(true)
    setShareResult(null)
    try {
      const result = await shareCard(cardRef.current, cardFilename(animalName, guestName))
      setShareResult(result)
    } catch (err) {
      setError(String(err))
    } finally {
      setShareBusy(false)
    }
  }

  const title = (
    <h2 id="collectible-purchase-title" className="collectible-purchase-title">
      <span className="collectible-purchase-icon-badge" aria-hidden="true">
        <PawIcon />
      </span>
      {animalName}
    </h2>
  )

  if (step === 'reveal' && card) {
    return (
      <Modal onClose={onClose} labelledBy="collectible-purchase-title" className="collectible-purchase-modal-frame">
        <div className="collectible-purchase-modal-inner">
          <p className="collectible-purchase-reveal-eyebrow">You collected a new card!</p>
          <div ref={cardRef}>
            <CollectibleCardVisual
              animalSlug={card.animal_slug}
              photoIndex={card.photo_index}
              guestName={card.guest_name}
              className="collectible-purchase-reveal-card"
            />
          </div>
          {error && <p className="screen-error">{error}</p>}
          {shareResult === 'shared' && <p className="collectible-purchase-share-note">Shared!</p>}
          <div className="collectible-purchase-actions">
            <button type="button" className="btn btn-secondary" onClick={handleDownload}>
              Download Image
            </button>
            {canShareFiles() && (
              <button type="button" className="btn btn-secondary" disabled={shareBusy} onClick={handleShare}>
                {shareBusy ? 'Sharing…' : 'Share'}
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal onClose={onClose} labelledBy="collectible-purchase-title" className="collectible-purchase-modal-frame">
      <div className="collectible-purchase-modal-inner">
        {title}
        <p className="collectible-purchase-price">🪙 {entry.price} Cobb Coins</p>
        <form className="collectible-purchase-form" onSubmit={handleSubmit}>
          <label className="collectible-purchase-label" htmlFor="collectible-guest-name">
            Who&rsquo;s collecting this one?
          </label>
          <input
            id="collectible-guest-name"
            type="text"
            className="collectible-purchase-input"
            placeholder="Name"
            value={guestName}
            maxLength={60}
            disabled={step === 'revealing'}
            onChange={(e) => setGuestName(e.target.value)}
            autoFocus
          />
          {error && <p className="screen-error">{error}</p>}
          <div className="collectible-purchase-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={step === 'revealing'}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={step === 'revealing'}>
              {step === 'revealing' ? 'Collecting…' : 'Collect'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
