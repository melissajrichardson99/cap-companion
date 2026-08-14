import { GOOGLE_REVIEW_URL } from '../homePageContent'
import { Modal } from './Modal'
import './PassportReviewModal.css'

interface PassportReviewModalProps {
  onDismiss: () => void
}

// Second touchpoint for the same review ask as the Home page's "Leave a
// Review, Get a Treat!" card (homePageContent.ts's GOOGLE_REVIEW_URL) --
// shown right after a Family Passport is generated, since that's typically
// the moment a family is wrapping up and heading toward the General Store.
// Dismissing (backdrop click, Escape, or "Maybe Later") never closes the
// passport itself -- PassportModal renders this as a step *before* the
// passport card, and onDismiss just advances past it to that card.
export function PassportReviewModal({ onDismiss }: PassportReviewModalProps) {
  return (
    <Modal onClose={onDismiss} labelledBy="passport-review-title" className="passport-modal-frame">
      <div className="passport-modal-inner passport-review-modal">
        <span className="passport-review-emoji" aria-hidden="true">
          ⭐
        </span>
        <p className="passport-review-eyebrow">Passport complete!</p>
        <h2 id="passport-review-title" className="passport-review-title">
          Leave a Review, Get a Treat!
        </h2>
        <p className="passport-review-text">
          Before you head out, tell us how your visit went! Leave us a review on Google and grab a free treat from
          the General Store — just show your review at the counter.
        </p>
        <a
          className="btn btn-primary passport-review-cta"
          href={GOOGLE_REVIEW_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          ⭐ Leave a Google Review
        </a>
        <button type="button" className="btn btn-secondary passport-review-dismiss" onClick={onDismiss}>
          Maybe later
        </button>
      </div>
    </Modal>
  )
}
