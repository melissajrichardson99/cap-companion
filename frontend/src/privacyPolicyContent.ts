// Static content for the Privacy Policy page, transcribed verbatim from the
// finalized privacy_policy_draft.md -- legal-adjacent copy, so wording and
// structure are preserved exactly; only presentation is handled here. Same
// "Melissa edits these values directly" pattern as faqContent.ts/
// homePageContent.ts.
//
// Two fixes applied during transcription (presentation, not wording):
// - The source draft's "â" sequences are a mojibake of an em dash ("—")
//   introduced wherever the draft was saved/copied through a lossy encoding
//   step -- restored to "—" here.
// - The Contact Us email was corrected from the draft's info@cobbsadventurepark.ca
//   to the actual domain, info@cobbsadventurepark.com, per Melissa.

export const PRIVACY_POLICY_LAST_UPDATED = 'September 13, 2026'
export const PRIVACY_POLICY_CONTACT_EMAIL = 'info@cobbsadventurepark.com'

export type PrivacyBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }

export interface PrivacySubsection {
  heading: string
  blocks: PrivacyBlock[]
}

export interface PrivacySection {
  // null only for the un-headed intro that precedes the first "##" heading.
  heading: string | null
  blocks: PrivacyBlock[]
  // Used only by "Information We Collect", whose "###" subheadings each need
  // their own heading level below the section's own "##" heading.
  subsections?: PrivacySubsection[]
}

export const PRIVACY_POLICY_SECTIONS: PrivacySection[] = [
  {
    heading: null,
    blocks: [
      {
        type: 'paragraph',
        text: 'Cobb\'s Adventure Park ("Cobb\'s," "we," "us," or "our") operates the Cobb\'s Adventure Park Companion App (the "App") to enhance your visit. This policy explains what information we collect through the App, how we use it, and the choices you have.',
      },
      {
        type: 'paragraph',
        text: "This policy is written to reflect how the App actually works today, and follows the general framework of Alberta's Personal Information Protection Act (PIPA). If anything about the App changes, we'll update this policy to match.",
      },
    ],
  },
  {
    heading: 'Information We Collect',
    blocks: [],
    subsections: [
      {
        heading: 'Account information (optional)',
        blocks: [
          {
            type: 'paragraph',
            text: "You can create an account with an email address and password to save your progress (Cobb Coins, Collectibles, Bingo and Map exploration progress, and your Family Passport history) across visits. Your password is never stored in plain text — it's protected using industry-standard hashing before it's saved. Creating an account is entirely optional; the App is fully usable without one.",
          },
        ],
      },
      {
        heading: 'Anonymous visit data',
        blocks: [
          {
            type: 'paragraph',
            text: "If you don't create an account, the App still needs to track your progress during a single visit (which Bingo tiles you've completed, which Scavenger Hunt characters you've found, your Cobb Coins balance, and so on). This is done using a random, non-identifying code stored on your device — it isn't tied to your name, email, or any other personal information, and it's automatically deleted after a period of inactivity.",
          },
        ],
      },
      {
        heading: 'Photos you submit',
        blocks: [
          {
            type: 'paragraph',
            text: 'If you choose to submit a photo through the Favorite Photo feature, that photo is reviewed by Cobb\'s staff before it may be shown publicly in the App (for example, as part of "Photo of the Day"). Please only submit photos you have the right to share, and please be mindful of the privacy of others — including children — who may appear in a photo you submit.',
          },
          {
            type: 'paragraph',
            text: "**A note for parents and guardians:** if you submit a photo that includes your child, you're confirming you have the right and permission to share that image through the App. We rely on staff review before any photo is shown publicly, but we encourage families to think carefully before submitting any photo of a minor.",
          },
        ],
      },
      {
        heading: 'Messages to staff',
        blocks: [
          {
            type: 'paragraph',
            text: 'If you use the "Contact Staff" feature, you may optionally provide your name and a description of your question or concern. This information is used only to help our staff respond to you and is kept as an internal record of the request.',
          },
        ],
      },
      {
        heading: 'Usage and engagement data',
        blocks: [
          {
            type: 'paragraph',
            text: "We collect aggregate, internal statistics about how the App is used — for example, how many people used a given feature, how far guests typically get through the Scavenger Hunt, or which map locations are visited most often. This information is used by Cobb's staff and management to understand engagement and improve the park experience. It is reported in aggregate and is not shared outside of Cobb's Adventure Park.",
          },
        ],
      },
      {
        heading: 'Information we do not currently collect',
        blocks: [
          {
            type: 'paragraph',
            text: "We do not currently collect your email address in connection with photo submissions, and we do not run any contest requiring your contact information. If that ever changes, we will update this policy first and clearly explain what's being collected and why before asking for it.",
          },
        ],
      },
    ],
  },
  {
    heading: 'How We Use Your Information',
    blocks: [
      { type: 'paragraph', text: 'We use the information described above only to:' },
      {
        type: 'list',
        items: [
          "Operate the App's features (Bingo, Scavenger Hunt, Cobb Coins, Collectibles, Family Passport, Photo of the Day, and similar features)",
          'Let you save and restore your progress across visits, if you choose to create an account',
          'Respond to questions or concerns you send to our staff',
          'Understand how the App is used so we can improve it',
          'Keep the App and your account secure',
        ],
      },
      {
        type: 'paragraph',
        text: 'We do not sell your personal information, and we do not use it for advertising or share it with third parties for their own marketing purposes.',
      },
    ],
  },
  {
    heading: 'Where Your Information Is Stored',
    blocks: [
      {
        type: 'paragraph',
        text: 'The App is built using the following third-party service providers, who host or process data on our behalf:',
      },
      {
        type: 'list',
        items: [
          '**Supabase** — our database and photo storage provider',
          "**Render** — hosts the App's backend",
          "**Cloudflare** — hosts and delivers the App's website",
          '**Resend** — sends account-related emails, such as password reset messages',
        ],
      },
      {
        type: 'paragraph',
        text: 'These providers only process information as needed to operate the App and are not permitted to use it for their own purposes.',
      },
    ],
  },
  {
    heading: 'How Long We Keep Your Information',
    blocks: [
      {
        type: 'list',
        items: [
          '**Account information** is kept for as long as your account exists. You can request that your account and its associated data be deleted at any time (see "Your Rights" below).',
          "**Anonymous visit data** (for guests who don't create an account) is automatically deleted after approximately two weeks of inactivity.",
          '**Messages sent to staff** are kept as an internal record so our team can track and respond to guest questions and concerns over time.',
        ],
      },
    ],
  },
  {
    heading: 'Your Rights',
    blocks: [
      { type: 'paragraph', text: "Under Alberta's privacy law, you have the right to:" },
      {
        type: 'list',
        items: [
          'Ask what personal information we hold about you',
          'Request that inaccurate information be corrected',
          'Request that your account and associated personal information be deleted',
        ],
      },
      { type: 'paragraph', text: 'To make any of these requests, please contact us using the information below.' },
    ],
  },
  {
    heading: "Children's Privacy",
    blocks: [
      {
        type: 'paragraph',
        text: "The App is designed to be used by families, including children, typically alongside a parent or guardian. We do not knowingly collect account information (email/password) directly from children — account creation is intended for use by an adult member of the visiting family or group. If you believe a child has created an account or submitted information without appropriate parental involvement, please contact us so we can address it.",
      },
    ],
  },
  {
    heading: 'Security',
    blocks: [
      {
        type: 'paragraph',
        text: 'We take reasonable steps to protect the information we hold, including secure password storage, access controls on our systems, and working with reputable infrastructure providers. However, no online system can be guaranteed 100% secure, and we encourage you to use a unique password for your account.',
      },
    ],
  },
  {
    heading: 'Changes to This Policy',
    blocks: [
      {
        type: 'paragraph',
        text: 'We may update this policy from time to time as the App changes. We\'ll update the "Last updated" date above when we do, and significant changes will be noted clearly.',
      },
    ],
  },
  {
    heading: 'Contact Us',
    blocks: [
      {
        type: 'paragraph',
        text: "If you have questions about this policy or how your information is handled, or if you'd like to make a request about your data, please contact us at:",
      },
      { type: 'paragraph', text: `**${PRIVACY_POLICY_CONTACT_EMAIL}**` },
      { type: 'paragraph', text: 'Or use the "Contact Staff" feature within the App.' },
    ],
  },
]
