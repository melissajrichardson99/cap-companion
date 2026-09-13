import { Fragment } from 'react'
import { PRIVACY_POLICY_LAST_UPDATED, PRIVACY_POLICY_SECTIONS, type PrivacyBlock } from '../privacyPolicyContent'
import { ShieldIcon } from './NavIcons'
import './PrivacyScreen.css'

// Splits "some **bold** text" into plain-text/<strong> runs. The source
// draft only ever uses ** for bold (no italics, links, or nesting), so a
// single non-greedy split covers every block in privacyPolicyContent.ts.
function renderInline(text: string) {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>,
  )
}

function PrivacyBlocks({ blocks }: { blocks: PrivacyBlock[] }) {
  return (
    <>
      {blocks.map((block, i) =>
        block.type === 'list' ? (
          <ul key={i} className="privacy-list">
            {block.items.map((item, j) => (
              <li key={j}>{renderInline(item)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{renderInline(block.text)}</p>
        ),
      )}
    </>
  )
}

// Legal-adjacent static content route (Contents come from
// privacyPolicyContent.ts, transcribed verbatim from the finalized draft --
// see that file's header comment for the two presentation-only fixes
// applied). Deliberately a plain, flowing long-form text layout rather than
// FaqScreen's parchment-card-per-item treatment -- a single continuous
// document reads better here than a stack of separate cards.
export function PrivacyScreen() {
  return (
    <div className="privacy-screen">
      <h1 className="cap-sign-board">
        <ShieldIcon className="cap-sign-board-icon" />
        Privacy Policy
      </h1>
      <p className="privacy-last-updated">Last updated: {PRIVACY_POLICY_LAST_UPDATED}</p>

      <article className="privacy-content cap-parchment-card">
        {PRIVACY_POLICY_SECTIONS.map((section, i) => (
          <section key={i} className="privacy-section">
            {section.heading && <h2 className="privacy-heading">{section.heading}</h2>}
            <PrivacyBlocks blocks={section.blocks} />
            {section.subsections?.map((sub, j) => (
              <div key={j} className="privacy-subsection">
                <h3 className="privacy-subheading">{sub.heading}</h3>
                <PrivacyBlocks blocks={sub.blocks} />
              </div>
            ))}
          </section>
        ))}
      </article>
    </div>
  )
}
