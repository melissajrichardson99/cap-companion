import { useState } from 'react'
import { FAQ_ENTRIES } from '../faqContent'
import { PAGE_SUBHEADERS } from '../pageSubheaderContent'
import { QuestionMarkIcon, StoreIcon } from './NavIcons'
import './FaqScreen.css'

interface FaqScreenProps {
  // Lets the "Where are your washrooms located?" answer jump straight to the
  // Map page's "Take Me There" > Washrooms highlight (see
  // keySpotCategories.ts) instead of only offering the plain-text
  // directions. Optional so FaqScreen still renders standalone if App.tsx
  // ever needs to skip the wiring.
  onOpenMapKeySpot?: (key: string) => void
}

export function FaqScreen({ onOpenMapKeySpot }: FaqScreenProps) {
  const [openQuestions, setOpenQuestions] = useState<Set<number>>(new Set())

  const toggleQuestion = (index: number) => {
    setOpenQuestions((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  return (
    <div className="faq-screen">
      <h1 className="cap-sign-board">
        <QuestionMarkIcon className="cap-sign-board-icon" />
        FAQ
      </h1>
      <p className="cap-page-subheader">{PAGE_SUBHEADERS.faq}</p>

      <div className="faq-list">
        {FAQ_ENTRIES.map((entry, index) => {
          const isOpen = openQuestions.has(index)
          return (
            <section key={entry.question} className="faq-item cap-parchment-card">
              <button
                type="button"
                className="faq-item-toggle"
                aria-expanded={isOpen}
                aria-controls={`faq-answer-${index}`}
                onClick={() => toggleQuestion(index)}
              >
                <QuestionMarkIcon className="faq-item-icon" />
                <span className="faq-item-question">{entry.question}</span>
                <span className="faq-item-chevron" aria-hidden="true">
                  {isOpen ? '▾' : '▸'}
                </span>
              </button>
              {isOpen && (
                <div id={`faq-answer-${index}`} className="faq-item-answer">
                  <p>{entry.answer}</p>
                  {entry.keySpotKey && onOpenMapKeySpot && (
                    <button
                      type="button"
                      className="faq-item-map-link"
                      onClick={() => onOpenMapKeySpot(entry.keySpotKey!)}
                    >
                      Show me on the map
                    </button>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>

      <div className="faq-help-card cap-parchment-card">
        <StoreIcon className="faq-help-icon" />
        <div className="faq-help-text">
          <h2 className="cap-section-title faq-help-title">Still need help?</h2>
          <p className="faq-help-body">Visit the General Store or ask any staff member. We're here to help!</p>
        </div>
      </div>
    </div>
  )
}
