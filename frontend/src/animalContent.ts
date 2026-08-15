// Real (mockup-stage) content for the "Our Animals" feature (rebranded
// Encyclopedia, Plan.md 2.5/5) -- a fixed 6-animal roster, independent of
// both the Scavenger Hunt's 5-character roster (huntCharacterContent.ts) and
// the minigame animal art library. Content below is Melissa's own draft copy
// (not yet reviewed by park staff) -- real content to ship now, but expect
// another revision pass later. Purely a frontend constant (not fetched from
// the backend): this roster/content has no relation to the
// `encyclopedia_entries` table, which only backs the existing
// QR-scan-to-EncyclopediaEntryScreen stub.
//
// Photos live in frontend/public/animals/<slug>/1..5.{jpg,png} -- dropped in
// by Melissa outside of source control review, so counts/extensions vary per
// animal (some animals don't have a 5th photo yet). Every image reference
// resolves through imageCandidates() + the AnimalImage component's runtime
// jpg -> png -> placeholder-SVG fallback chain, so a missing file degrades
// gracefully instead of breaking the layout, and dropping in the missing
// photos later needs no code changes.
export interface AnimalFact {
  label: string
  value: string
}

export interface AnimalPhoto {
  candidates: string[]
  alt: string
}

export interface AnimalNugget {
  title: string
  text: string
  imageCandidates: string[]
}

export interface AnimalContent {
  slug: string
  name: string
  photoCandidates: string[]
  aboutHeading: string
  description: string
  facts: AnimalFact[]
  photos: AnimalPhoto[]
  nuggets: AnimalNugget[]
}

export const PLACEHOLDER_PHOTO_SRC = '/animal-photo-placeholder.svg'
const PHOTOS_PER_ANIMAL = 5

function imageCandidates(slug: string, index: number): string[] {
  return [`/animals/${slug}/${index}.jpg`, `/animals/${slug}/${index}.png`]
}

function buildPhotos(slug: string, name: string): AnimalPhoto[] {
  return Array.from({ length: PHOTOS_PER_ANIMAL }, (_, i) => ({
    candidates: imageCandidates(slug, i + 1),
    alt: `Photo ${i + 1} of ${name}`,
  }))
}

// 6 info cards cycle through the 5 available photos (card 6 reuses photo 1).
function nuggetImage(slug: string, cardIndex: number): string[] {
  const photoIndex = (cardIndex % PHOTOS_PER_ANIMAL) + 1
  return imageCandidates(slug, photoIndex)
}

interface AnimalDefinition {
  name: string
  slug: string
  aboutHeading: string
  description: string
  facts: AnimalFact[]
  nuggets: { title: string; text: string }[]
}

function buildAnimal(def: AnimalDefinition): AnimalContent {
  return {
    slug: def.slug,
    name: def.name,
    photoCandidates: imageCandidates(def.slug, 1),
    aboutHeading: def.aboutHeading,
    description: def.description,
    facts: def.facts,
    photos: buildPhotos(def.slug, def.name),
    nuggets: def.nuggets.map((nugget, i) => ({
      title: nugget.title,
      text: nugget.text,
      imageCandidates: nuggetImage(def.slug, i),
    })),
  }
}

const ANIMAL_DEFINITIONS: AnimalDefinition[] = [
  {
    name: 'Capybara',
    slug: 'capybara',
    aboutHeading: "The World's Largest Rodent",
    description:
      'Capybaras are the largest living rodents in the world. They are semi-aquatic animals native to Central and South America, where they live near rivers, ponds, marshes, and other bodies of water. Capybaras are excellent swimmers and spend plenty of time in the water to stay cool and escape danger. They\'re also highly social and usually live in groups.',
    facts: [
      { label: 'Scientific name', value: 'Hydrochoerus hydrochaeris' },
      { label: 'Diet', value: 'Herbivore' },
      { label: 'Home', value: 'Central & South America' },
      { label: 'Habitat', value: 'Wetlands, grasslands & forests' },
      { label: 'Size', value: 'About 50–65 cm tall at the shoulder' },
      { label: 'Conservation', value: 'Least Concern' },
    ],
    nuggets: [
      {
        title: 'The Giant Rodent',
        text: "Capybaras are the largest rodents in the world! Despite their size, they're relatives of guinea pigs and other cavies.",
      },
      {
        title: 'Built for Swimming',
        text: 'Capybaras have slightly webbed feet that help them swim. Their eyes, ears, and nostrils sit high on their heads so they can stay mostly underwater while still keeping watch.',
      },
      {
        title: "What's for Dinner?",
        text: 'Capybaras are herbivores. They mainly munch on grasses and aquatic plants, using their constantly growing front teeth to help them graze.',
      },
      {
        title: 'Safety First!',
        text: 'When danger approaches, a capybara can dive underwater and hide. They can stay submerged for several minutes!',
      },
      {
        title: 'Party Animals',
        text: 'Capybaras are very social. They usually live in groups, which helps them stay alert for predators and find safety in numbers.',
      },
      {
        title: 'Water Pig?',
        text: 'The scientific name Hydrochoerus hydrochaeris is associated with the idea of a "water hog." Their chunky bodies and love of water certainly make the nickname feel appropriate!',
      },
    ],
  },
  {
    name: 'Kangaroo',
    slug: 'kangaroo',
    aboutHeading: "Australia's Famous Hoppers",
    description:
      'Kangaroos are large Australian marsupials famous for their powerful hind legs, long tails, and incredible ability to hop. Female kangaroos carry their young, called joeys, in a pouch while they continue developing. Kangaroos are herbivores and spend much of their time grazing on grasses and other plants.',
    facts: [
      { label: 'Type', value: 'Marsupial' },
      { label: 'Diet', value: 'Herbivore' },
      { label: 'Home', value: 'Australia' },
      { label: 'Special feature', value: 'Powerful hind legs & balancing tail' },
      { label: 'Baby', value: 'Joey' },
      { label: 'Group', value: 'Mob' },
    ],
    nuggets: [
      {
        title: "What's a Joey?",
        text: "A baby kangaroo is called a joey. Joeys are born extremely small and underdeveloped, then climb into their mother's pouch to continue growing.",
      },
      {
        title: 'Built to Bounce',
        text: 'Kangaroos have huge hind legs and strong tendons that make hopping an incredibly efficient way to travel.',
      },
      {
        title: 'A Tail for Balance',
        text: "A kangaroo's muscular tail isn't just for looks! It helps the animal balance while hopping and can act almost like an extra limb when moving slowly.",
      },
      {
        title: "What's on the Menu?",
        text: 'Kangaroos are herbivores. They spend much of their time grazing on grass and other vegetation.',
      },
      {
        title: 'Meet the Mob',
        text: 'A group of kangaroos is called a mob. Kangaroos often gather together to feed, rest, and keep watch for danger.',
      },
      {
        title: 'Avoiding the Heat',
        text: 'Kangaroos are often most active during the cooler parts of the day, such as early morning and late afternoon.',
      },
    ],
  },
  {
    name: 'Alpaca',
    slug: 'alpaca',
    aboutHeading: 'The Fluffy Camelid',
    description:
      'Alpacas are domesticated relatives of camels that originated in the Andes of South America. They were bred by people for thousands of years for their soft, valuable fleece. Alpacas are social herd animals and spend much of their day grazing. Despite their fluffy appearance, they\'re surprisingly hardy animals adapted to life in mountainous environments.',
    facts: [
      { label: 'Scientific name', value: 'Vicugna pacos' },
      { label: 'Diet', value: 'Herbivore' },
      { label: 'Home', value: 'South America' },
      { label: 'Family', value: 'Camelidae' },
      { label: 'Famous for', value: 'Soft fleece' },
      { label: 'Size', value: 'Usually 100–200 lb as adults' },
    ],
    nuggets: [
      {
        title: 'Alpaca or Llama?',
        text: "Alpacas and llamas are close relatives, but they're different animals. Alpacas are generally smaller and more heavily built for their soft fleece.",
      },
      {
        title: "That's Some Fuzzy Fur!",
        text: 'Alpacas have a thick coat of soft fiber. Their fleece comes in many natural colors, from white and cream to brown, gray, and black.',
      },
      {
        title: "What's a Cria?",
        text: 'A baby alpaca is called a cria. Crias can stand and walk surprisingly soon after birth and grow quickly.',
      },
      {
        title: 'Herd Animals',
        text: 'Alpacas are social animals that feel safest around others. In the wild, related camelids live in groups, and domesticated alpacas also thrive with companions.',
      },
      {
        title: 'Can They Talk?',
        text: 'They can! Alpacas make a soft humming sound and use their ears, tails, and body posture to communicate.',
      },
      {
        title: "Don't Get Too Close!",
        text: "Alpacas can spit, but it's usually directed at other alpacas when they're annoyed or arguing. They rarely spit at people unless they're frightened or mistreated.",
      },
    ],
  },
  {
    name: 'Emu',
    slug: 'emu',
    aboutHeading: "Australia's Giant Runner",
    description:
      "The emu is Australia's largest bird — and one of the world's largest birds. But there's something it can't do: fly! Instead, emus have long, powerful legs that allow them to run quickly across Australia's varied landscapes. They have three toes on each foot and can travel long distances in search of food.",
    facts: [
      { label: 'Scientific name', value: 'Dromaius novaehollandiae' },
      { label: 'Diet', value: 'Omnivore' },
      { label: 'Home', value: 'Australia' },
      { label: 'Height', value: 'Up to about 1.9 m' },
      { label: 'Flight', value: 'Flightless' },
      { label: 'Conservation', value: 'Least Concern' },
    ],
    nuggets: [
      {
        title: 'No Flying Here!',
        text: 'Emus have tiny wings and cannot fly. Instead, they rely on their powerful legs to run away from danger.',
      },
      {
        title: 'Three Toes',
        text: "Look closely at an emu's feet! Each foot has three long toes with strong claws.",
      },
      {
        title: 'Tallest Bird in Australia',
        text: 'An adult emu can stand around 1.5–1.9 metres tall — that\'s taller than many people!',
      },
      {
        title: 'Dad Does the Babysitting',
        text: "Here's a surprising one: after the female lays her eggs, the male emu incubates them and cares for the chicks after they hatch.",
      },
      {
        title: 'Green Eggs!',
        text: 'Emu eggs are a beautiful dark green colour. A female can lay a clutch containing several large eggs.',
      },
      {
        title: 'Pebbles for Dinner?',
        text: "Emus swallow small stones called gastroliths. These help grind up food inside their digestive system because birds don't have teeth.",
      },
    ],
  },
  {
    name: 'Wallaby',
    slug: 'wallaby',
    aboutHeading: 'The Smaller Aussie Hopper',
    description:
      "Wallabies are marsupials from Australia and nearby islands. They're close relatives of kangaroos, but wallabies are generally smaller. Like kangaroos, female wallabies carry their young in a pouch. Wallabies are herbivores and use their powerful hind legs to hop through their environment.",
    facts: [
      { label: 'Type', value: 'Marsupial' },
      { label: 'Diet', value: 'Herbivore' },
      { label: 'Home', value: 'Australia & Tasmania' },
      { label: 'Baby', value: 'Joey' },
      { label: 'Special feature', value: 'Powerful hopping legs' },
      { label: 'Close relative', value: 'Kangaroo' },
    ],
    nuggets: [
      {
        title: 'Not a Baby Kangaroo!',
        text: "A wallaby isn't a baby kangaroo. They're different animals, although they're close relatives and share many of the same adaptations.",
      },
      {
        title: 'Joey in the Pouch',
        text: "Wallaby babies are called joeys. They're born extremely tiny and underdeveloped, then climb into their mother's pouch to continue growing.",
      },
      {
        title: 'Hop, Hop, Hop!',
        text: 'Hopping is an incredibly efficient way for wallabies to travel. Their powerful hind legs and stretchy tendons help recycle energy with every bounce.',
      },
      {
        title: 'Tiny but Mighty',
        text: 'Wallabies are generally much smaller than kangaroos. Some species stand around three feet tall or less.',
      },
      {
        title: "What's for Dinner?",
        text: 'Wallabies are herbivores. They eat grasses, herbs, and leafy plants, and some species may eat roots when food or water is scarce.',
      },
      {
        title: "A Tail That's More Than Decoration",
        text: "A wallaby's long tail helps with balance while hopping. When moving slowly, some wallabies can even use their tail as a fifth point of support!",
      },
    ],
  },
  {
    name: 'Goat',
    slug: 'goat',
    aboutHeading: 'Curious, Clever & Climbing',
    description:
      "Goats are domesticated ruminants that have lived alongside people for thousands of years. They're incredibly curious, social animals that love to investigate their surroundings. Unlike sheep and cattle, goats are excellent browsers, meaning they like reaching for leaves, shrubs, and other plants rather than simply grazing on grass.",
    facts: [
      { label: 'Scientific name', value: 'Capra hircus' },
      { label: 'Diet', value: 'Herbivore' },
      { label: 'Family', value: 'Bovidae' },
      { label: 'Domesticated', value: 'Thousands of years ago' },
      { label: 'Special feature', value: 'Excellent climbers & browsers' },
      { label: 'Fun fact', value: 'Rectangular pupils!' },
    ],
    nuggets: [
      {
        title: 'Look at Those Eyes!',
        text: 'Goats have unusual rectangular pupils. This gives them a wide field of vision while their heads are down searching for food.',
      },
      {
        title: 'More Than Grass',
        text: "Goats are browsers. They'll happily investigate leaves, shrubs, weeds, and woody plants rather than sticking to grass.",
      },
      {
        title: 'Four Compartments?!',
        text: 'Goats are ruminants, which means their stomach has four compartments that help them digest tough plant material.',
      },
      {
        title: 'Born to Climb',
        text: 'Goats are excellent climbers and jumpers. Their specialized hooves help them navigate steep and uneven surfaces.',
      },
      {
        title: 'Super Curious',
        text: 'Goats are naturally inquisitive. They investigate unfamiliar objects by sniffing, touching, and sometimes trying to nibble them!',
      },
      {
        title: 'Smart Cookies',
        text: 'Goats can learn quickly. Animal-care teams can train goats to participate voluntarily in health checks and even perform fun behaviors.',
      },
    ],
  },
]

export const ANIMALS: AnimalContent[] = ANIMAL_DEFINITIONS.map(buildAnimal)
