// Real (mockup-stage) content for the "Our Animals" feature (rebranded
// Encyclopedia, Plan.md 2.5/5) -- a 20-animal roster, independent of
// both the Scavenger Hunt's 5-character roster (huntCharacterContent.ts) and
// the minigame animal art library. Content below is Melissa's own draft copy
// (not yet reviewed by park staff) -- real content to ship now, but expect
// another revision pass later. Purely a frontend constant (not fetched from
// the backend): this roster/content has no relation to the
// `encyclopedia_entries` table, which only backs the existing
// QR-scan-to-EncyclopediaEntryScreen stub.
//
// Photos themselves are NOT part of this static content -- Our Animals now
// fetches them dynamically from the staff-managed animal-photos API
// (api.listAnimalPhotos, consumed by AnimalsScreen/AnimalDetailScreen/
// AnimalCardsScreen). imageCandidates()/PLACEHOLDER_PHOTO_SRC below are kept
// only for Collectibles (CollectibleCardVisual.tsx, CollectibleShop.tsx),
// which still resolves its own curated photo pool straight against the
// static files in frontend/public/animals/<slug>/1..3.{jpg,png} and is
// deliberately unaffected by the dynamic animal-photos system.
export interface AnimalFact {
  label: string
  value: string
}

export interface AnimalNugget {
  title: string
  text: string
}

export interface AnimalContent {
  slug: string
  name: string
  aboutHeading: string
  // Optional one-line subtitle under aboutHeading -- only the animals added
  // with the heading/tagline/intro content shape use it so far.
  tagline?: string
  description: string
  // Can be empty (the facts table is then hidden) for animals whose content
  // doesn't have a facts list yet.
  facts: AnimalFact[]
  nuggets: AnimalNugget[]
}

export const PLACEHOLDER_PHOTO_SRC = '/animal-photo-placeholder.svg'

// Collectibles-only: resolves a purchased/previewed card's photo via the
// slug + 1-based index convention -- see CollectibleCard.photo_index and
// collectibles.py's PHOTO_POOL_SIZE. NOT used by Our Animals anymore.
export function imageCandidates(slug: string, index: number): string[] {
  return [`/animals/${slug}/${index}.jpg`, `/animals/${slug}/${index}.png`]
}

interface AnimalDefinition {
  name: string
  slug: string
  aboutHeading: string
  tagline?: string
  description: string
  facts: AnimalFact[]
  nuggets: { title: string; text: string }[]
}

function buildAnimal(def: AnimalDefinition): AnimalContent {
  return {
    slug: def.slug,
    name: def.name,
    aboutHeading: def.aboutHeading,
    tagline: def.tagline,
    description: def.description,
    facts: def.facts,
    nuggets: def.nuggets,
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
  {
    name: 'Sloth',
    slug: 'sloth',
    aboutHeading: 'Meet the Sloth',
    description:
      "Slow and steady is the sloth's specialty! Get to know one of nature's most laid-back mammals and discover why life in the treetops is perfectly suited to this unusual animal.",
    facts: [
      { label: 'Scientific name', value: 'Choloepus didactylus' },
      { label: 'Also known as', value: "Linnaeus's two-toed sloth" },
      { label: "Where they're from", value: 'Central & northern South America' },
      { label: 'Habitat', value: 'Tropical forests' },
      { label: 'Diet', value: 'Leaves, fruit, flowers and other plant material' },
      { label: 'Lifestyle', value: 'Mostly solitary and tree-dwelling' },
      {
        label: 'Fun fact',
        value: 'Two-toed sloths actually have two claws on each front foot and three toes on their back feet',
      },
    ],
    nuggets: [
      {
        title: 'Life in the Canopy',
        text: 'Sloths spend most of their lives up in trees. Their long limbs and large curved claws help them grip branches while they move through the canopy.',
      },
      {
        title: 'Why So Slow?',
        text: 'Moving slowly takes less energy, which is useful for an animal that eats a relatively low-energy diet. Sloths have a very slow metabolism and spend much of their day resting.',
      },
      {
        title: 'Upside-Down Specialists',
        text: "A sloth's body is specially adapted for hanging beneath branches. Their curved claws act almost like built-in hooks, allowing them to hang on without constantly using their muscles.",
      },
      {
        title: 'A Tiny Ecosystem',
        text: "A sloth's coarse fur can develop a greenish tint because algae grow in grooves along the hairs. Their fur can also provide a home for tiny organisms such as moths and beetles.",
      },
      {
        title: 'Sleepy... But Not Always!',
        text: "Sloths spend a lot of time resting, but they're not completely inactive. They can climb, swim, forage and move surprisingly well when they need to.",
      },
      {
        title: 'Built for the Trees',
        text: 'Their large eyes help them navigate their environment, while their short, flat heads and snub noses are characteristic features of two-toed sloths.',
      },
    ],
  },
  {
    name: 'Porcupine',
    slug: 'porcupine',
    aboutHeading: 'African Crested Porcupine',
    description:
      "Don't let those quills fool you! Porcupines are fascinating, slow-moving rodents with an incredible natural defense system and a surprisingly impressive ability to climb.",
    facts: [
      { label: 'Scientific name', value: 'Hystrix africaeaustralis (verify with Cobb\'s)' },
      { label: 'Also known as', value: 'Cape porcupine / South African crested porcupine' },
      { label: "Where they're from", value: 'Southern Africa' },
      { label: 'Habitat', value: 'Savannas, grasslands, woodlands and rocky areas' },
      { label: 'Diet', value: 'Plants, roots, bulbs, bark and other vegetation' },
      { label: 'Lifestyle', value: 'Mostly nocturnal' },
      { label: 'Size', value: "One of Africa's largest rodents" },
      { label: 'Special feature', value: 'Long, black-and-white defensive quills' },
    ],
    nuggets: [
      {
        title: "Those Aren't Hair!",
        text: "A porcupine's most famous feature is its quills. They're specialized hairs made of keratin — the same tough material found in our hair and fingernails.",
      },
      {
        title: "No, They Can't Shoot Them!",
        text: 'This is one of the biggest porcupine myths. Porcupines cannot shoot their quills. When threatened, they raise their quills and may turn their back toward a predator. Quills can detach when they make contact with an attacker.',
      },
      {
        title: 'A Very Good Defense',
        text: "Those dramatic black-and-white quills aren't just decoration. When a porcupine feels threatened, it can raise its quills to make itself look much larger and more intimidating.",
      },
      {
        title: 'Night Owl... Sort Of',
        text: "Porcupines are primarily nocturnal, meaning they're most active at night. During the day, they may rest in dens or other sheltered locations.",
      },
      {
        title: "They're Vegetarians",
        text: 'Porcupines are herbivores. Their diets can include roots, bulbs, bark, leaves and other plant material.',
      },
      {
        title: 'Surprisingly Good Climbers',
        text: 'Despite their chunky bodies and short legs, porcupines can climb. Their strong claws help them navigate trees and other surfaces while searching for food or shelter.',
      },
    ],
  },
  {
    name: 'Pig',
    slug: 'pig',
    aboutHeading: 'Meet the Pig',
    description:
      'Smart, curious, and much more than just a curly tail! Pigs are surprisingly intelligent animals with excellent senses and lots of personality. Get to know these fascinating farm animals and see what makes them such great explorers.',
    facts: [
      { label: 'Scientific name', value: 'Sus scrofa domesticus' },
      { label: 'Also known as', value: 'Domestic pig' },
      { label: 'Diet', value: 'Omnivorous' },
      { label: 'Habitat', value: 'Farms, grasslands, woodlands, and other managed environments' },
      { label: 'Lifespan', value: 'Often 10–15 years with proper care' },
      { label: 'Special talents', value: 'Excellent sense of smell, strong memory, and problem-solving skills' },
    ],
    nuggets: [
      {
        title: 'A Nose for Adventure',
        text: "A pig's snout isn't just cute — it's an incredibly useful tool. Their excellent sense of smell helps them find food and investigate their surroundings.",
      },
      {
        title: 'Surprisingly Smart',
        text: 'Pigs are highly intelligent animals. They can learn routines, remember things they\'ve encountered before, and solve problems to get what they want.',
      },
      {
        title: "What's for Dinner?",
        text: "Pigs are omnivores, meaning they can eat both plant and animal-based foods. At Cobb's, their diet is carefully managed to make sure they get the nutrition they need.",
      },
      {
        title: 'The Snout Does the Work',
        text: 'Pigs use their noses to explore the world around them. They can root through soil looking for interesting smells and tasty food.',
      },
      {
        title: 'Pigs Have a Lot to Say',
        text: 'Pigs communicate using a surprising variety of sounds, including grunts, squeals, and other vocalizations. Different sounds can mean different things depending on the situation.',
      },
      {
        title: "Mud Isn't Just for Fun!",
        text: "You've probably seen pigs rolling around in mud. It can actually help them cool down and protect their skin from the sun. Pigs don't have very effective sweat glands, so mud can be an important part of staying comfortable.",
      },
    ],
  },
  // The 11 animals below are first-version general content (drafted, then
  // fact-checked, but not yet park-specific): a "Meet the ...!" heading,
  // tagline, intro and 5 cards, with no facts table yet. Park-specific
  // details (names, ages, species/breed, feeding times) come later -- add
  // them as `facts` rows and/or extra nuggets. Grouped after the original 9:
  // exotic mammals, then reptiles, then farm & small animals.
  {
    name: 'Wallaroo',
    slug: 'wallaroo',
    aboutHeading: 'Meet the Wallaroo!',
    tagline: 'Built for rocky country',
    description:
      'Wallaroos are Australian marsupials related to kangaroos and wallabies. They are generally stockier than kangaroos and are well suited to rugged, rocky habitats. Like kangaroos and wallabies, females raise their young in a pouch during an important stage of development.',
    facts: [],
    nuggets: [
      {
        title: 'Somewhere between',
        text: "The name wallaroo is commonly used for certain stocky kangaroo relatives. Wallaroos are often described as having features between those of kangaroos and wallabies, although the names don't represent a simple size ladder.",
      },
      {
        title: 'A built-in nursery',
        text: "Wallaroos are marsupials. Their tiny young continue developing in their mother's pouch after birth.",
      },
      {
        title: 'Powerful back legs',
        text: 'Their strong hind legs help them hop across uneven terrain. Their long tails help with balance and support.',
      },
      {
        title: 'Life in rocky places',
        text: 'Many wallaroos use rocky hills and outcrops for shelter from heat and predators. These habitats offer places to rest and stay protected.',
      },
      {
        title: 'Plant-powered',
        text: 'Wallaroos mainly eat vegetation, including grasses and other plants. Their diet and activity help them cope with the conditions of their habitat.',
      },
    ],
  },
  {
    name: 'Tamandua (Anteater)',
    slug: 'tamandua',
    aboutHeading: 'Meet the Tamandua!',
    tagline: 'A sticky-tongued insect hunter',
    description:
      'Tamanduas are tree-climbing relatives of the giant anteater found in Central and South America. They use their long snouts and powerful claws to find ants and termites hidden inside nests. Their long, sticky tongues help them collect tiny insects without needing teeth to chew them!',
    facts: [],
    nuggets: [
      {
        title: 'A tongue built for bugs',
        text: "A tamandua's tongue can extend a surprisingly long way from its mouth. It uses its sticky surface to gather ants and termites from narrow spaces.",
      },
      {
        title: 'A natural climber',
        text: 'Tamanduas have strong claws and grasping tails that help them climb trees. They can use their tails for extra support as they move through branches.',
      },
      {
        title: 'No teeth needed',
        text: "Tamanduas don't have teeth. Instead, they swallow their tiny prey and rely on their digestive system to process their food.",
      },
      {
        title: 'A nose for dinner',
        text: 'Their excellent sense of smell helps them locate insect nests. Their long snouts are perfectly suited to investigating small openings.',
      },
      {
        title: 'More than one kind',
        text: 'There are two species of tamandua, the northern and the southern. Neither is a giant anteater: tamanduas are smaller anteaters that spend much of their time climbing and searching for food in trees and on the ground.',
      },
    ],
  },
  {
    name: 'Sugar Glider',
    slug: 'sugar-glider',
    aboutHeading: 'Meet the Sugar Glider!',
    tagline: 'A tiny animal that can glide',
    description:
      'Sugar gliders are small nocturnal marsupials native to Australia and nearby regions. They have enormous eyes for their size and a furry membrane stretching between their wrists and ankles. By spreading this membrane, they can glide from tree to tree in search of food and shelter.',
    facts: [],
    nuggets: [
      {
        title: 'Flying without wings',
        text: "Sugar gliders don't truly fly. They stretch out a skin membrane called the patagium and glide through the air, steering with their limbs and tail.",
      },
      {
        title: 'Night-time explorers',
        text: "Sugar gliders are nocturnal, meaning they're most active at night. Their large eyes help them see in dim light while they search for food.",
      },
      {
        title: 'Sweet tooth, with variety',
        text: "Their natural diet can include nectar, tree sap, pollen, insects, and other small food sources. The exact mix changes with the season and what's available.",
      },
      {
        title: 'A pouch for growing up',
        text: "Like kangaroos and wallaroos, sugar gliders are marsupials. Their very young offspring continue developing in their mother's pouch after birth.",
      },
      {
        title: 'Social little gliders',
        text: 'Sugar gliders are social animals that commonly live in groups. They communicate using scent marking and a variety of vocal sounds.',
      },
    ],
  },
  {
    name: 'Tortoise',
    slug: 'tortoise',
    aboutHeading: 'Meet the Tortoise!',
    tagline: 'A slow-moving survivor',
    description:
      'Tortoises are land-dwelling reptiles known for their protective shells and steady pace. Different species live in environments ranging from dry grasslands to lush tropical regions. Many tortoises eat plants, and some can live for many decades with proper conditions.',
    facts: [],
    nuggets: [
      {
        title: "A shell that's part of the body",
        text: "A tortoise's shell is connected to its skeleton. It includes bone and a protective outer covering, so it isn't a removable house that the tortoise can leave behind.",
      },
      {
        title: 'Slow and steady',
        text: 'Tortoises often move slowly to conserve energy. Their pace also reflects their anatomy and the way they search for food.',
      },
      {
        title: 'Long-lived neighbours',
        text: 'Some tortoise species can live for many decades, and certain species can live well beyond 100 years.',
      },
      {
        title: 'Not all turtles are the same',
        text: 'Tortoises are a group of turtles adapted primarily to life on land. Unlike many aquatic turtles, they generally have sturdy, elephant-like feet rather than flippers.',
      },
      {
        title: 'Sunbathing serves a purpose',
        text: 'Reptiles depend on their surroundings to regulate body temperature. Basking in a suitable warm spot can help a tortoise become active and digest food.',
      },
    ],
  },
  {
    name: 'Iguana',
    slug: 'iguana',
    aboutHeading: 'Meet the Iguana!',
    tagline: 'A sun-loving reptile',
    description:
      'Iguanas are reptiles found mainly in the Americas and nearby tropical regions. The familiar green iguana is an excellent climber with a long tail, sharp claws, and a row of spines along its back. Many iguanas eat mostly plants and depend on external heat to regulate their body temperature.',
    facts: [],
    nuggets: [
      {
        title: 'Sun-powered warmth',
        text: 'Iguanas are ectotherms, which means their body temperature depends heavily on their surroundings. Basking in a suitable warm spot helps them become active.',
      },
      {
        title: 'A tail for defence',
        text: "An iguana's long tail helps it balance while climbing and can also be used to whip at a threat. Some lizards can drop part of their tails, although this varies by species and circumstances.",
      },
      {
        title: 'A third eye?',
        text: "Green iguanas have a light-sensitive structure on top of their heads called a parietal eye. It doesn't see detailed pictures like their regular eyes, but it helps detect light and may help them sense shadows overhead.",
      },
      {
        title: 'Excellent climbers',
        text: 'Strong limbs and sharp claws help many iguanas climb trees and grip branches. Their long tails provide extra balance as they move around.',
      },
      {
        title: "Green isn't the only colour",
        text: 'Iguanas can vary in colour depending on their species, age, health, and environmental conditions. Some individuals may appear more grey, brown, or orange than others.',
      },
    ],
  },
  {
    name: 'Snake',
    slug: 'snake',
    aboutHeading: 'Meet the Snake!',
    tagline: 'A master of movement',
    description:
      'Snakes are reptiles found in a huge variety of habitats around the world. They move without legs, use their tongues to gather scent particles from the air, and shed their skin as they grow. Different species have different diets, hunting techniques, and ways of protecting themselves.',
    facts: [],
    nuggets: [
      {
        title: 'A tongue that smells',
        text: "A snake flicks its forked tongue to collect tiny chemical particles. Special organs inside its mouth help it interpret those particles and learn what's happening in its surroundings.",
      },
      {
        title: 'How do snakes move?',
        text: 'Snakes use their muscles and flexible ribs to push against the ground, branches, or other surfaces. Their scales help provide traction as they travel.',
      },
      {
        title: 'Time for a new outfit',
        text: 'Snakes periodically shed their outer layer of skin as they grow. Shedding also helps replace worn skin and can remove some parasites.',
      },
      {
        title: 'Swallowing dinner whole',
        text: 'Many snakes swallow their prey whole. Their flexible skulls and jaws help them consume food that can be wider than their own heads.',
      },
      {
        title: 'Not every snake is venomous',
        text: 'Snakes use different methods to catch prey and defend themselves. Some species use venom, some constrict their prey, and others simply swallow small animals.',
      },
    ],
  },
  {
    name: 'Sheep',
    slug: 'sheep',
    aboutHeading: 'Meet the Sheep!',
    tagline: 'Fleece with a purpose',
    description:
      'Sheep are domesticated hoofed mammals that have been raised by people for thousands of years. Many breeds grow thick wool that can be harvested and used to make clothing and other textiles. Sheep are social grazers that often stay close to their flock.',
    facts: [],
    nuggets: [
      {
        title: 'Woolly wonders',
        text: "Wool is made from sheep's hair and helps insulate them from changing temperatures. Different breeds grow different types and amounts of wool.",
      },
      {
        title: 'Safety in numbers',
        text: 'Sheep are social animals that often graze and rest together. Staying with a group can help them notice potential danger.',
      },
      {
        title: 'Four-chambered stomachs',
        text: 'Sheep are ruminants. Their digestive system includes four compartments that help them break down fibrous plants, including grass.',
      },
      {
        title: 'Chewing twice',
        text: 'Sheep can bring partially digested food back up to their mouths and chew it again. This process, called rumination, helps them extract nutrients from tough plants.',
      },
      {
        title: 'Familiar faces',
        text: 'Sheep can recognize and remember individual sheep and human faces. They also communicate using bleats, posture, and other behaviours.',
      },
    ],
  },
  {
    name: 'Rabbit',
    slug: 'rabbit',
    aboutHeading: 'Meet the Rabbit!',
    tagline: 'Big ears, powerful hops',
    description:
      'Rabbits are small mammals known for their long ears, strong hind legs, and constantly growing teeth. They are herbivores that need a fibre-rich diet, and their powerful legs help them escape danger. Rabbits also use their ears, noses, and body posture to explore and communicate.',
    facts: [],
    nuggets: [
      {
        title: 'Teeth that never stop growing',
        text: "A rabbit's teeth continue growing throughout its life. Chewing fibrous foods such as grass and hay helps wear them down naturally.",
      },
      {
        title: 'Ears on alert',
        text: 'Rabbit ears can detect sounds from different directions. Depending on the rabbit and its ear shape, the ears can also help release excess body heat.',
      },
      {
        title: 'A powerful escape plan',
        text: 'Rabbits have strong hind legs that let them accelerate quickly and make sharp turns. Wild rabbits rely on speed and hiding places to avoid predators.',
      },
      {
        title: 'The bunny binky',
        text: 'A happy or excited rabbit may jump into the air and twist its body. This playful movement is called a binky.',
      },
      {
        title: "Rabbits aren't rodents",
        text: 'Rabbits belong to a mammal group called Lagomorpha, not the rodent group. One difference is that rabbits have an additional small pair of upper incisors behind their main front teeth.',
      },
    ],
  },
  {
    name: 'Ferret',
    slug: 'ferret',
    aboutHeading: 'Meet the Ferret!',
    tagline: 'A playful little explorer',
    description:
      'Domestic ferrets are small, long-bodied mammals related to weasels, otters, and minks. They are naturally curious and enjoy investigating tunnels, hiding places, and unfamiliar objects. Ferrets are carnivores, with bodies and behaviours adapted for hunting small prey.',
    facts: [],
    nuggets: [
      {
        title: 'The weasel family',
        text: 'Ferrets belong to the mustelid family, which includes weasels, badgers, otters, and wolverines. Many members of this family have long bodies and are excellent hunters.',
      },
      {
        title: 'Built for squeezing',
        text: 'Their long, flexible bodies help ferrets investigate narrow spaces and tunnels. This body shape is useful for exploring burrows and other tight hiding places.',
      },
      {
        title: 'The ferret dance',
        text: 'Excited ferrets sometimes perform a playful series of sideways hops, twists, and bounces. This energetic behaviour is often nicknamed the weasel war dance.',
      },
      {
        title: 'Sleepy little adventurers',
        text: 'Ferrets often sleep for many hours a day, with bursts of energetic play in between. Their activity patterns can vary depending on their environment and routine.',
      },
      {
        title: 'Curious by nature',
        text: 'Ferrets investigate their surroundings with their noses, paws, and mouths. Their curiosity makes enrichment and safe, supervised exploration important in their care.',
      },
    ],
  },
  {
    name: 'Chicken',
    slug: 'chicken',
    aboutHeading: 'Meet the Chicken!',
    tagline: 'A curious farmyard bird',
    description:
      'Chickens are domesticated birds with a fascinating social life. They use their beaks to investigate food, communicate through different calls, and spend much of their day scratching and pecking at the ground. Chickens also have surprisingly good memories and can recognize familiar individuals.',
    facts: [],
    nuggets: [
      {
        title: 'More than clucking',
        text: 'Chickens make a variety of sounds to communicate. Different calls can alert other chickens to food, danger, or other events happening nearby.',
      },
      {
        title: 'The pecking order',
        text: 'Chickens establish social hierarchies within their groups. The phrase pecking order comes from the way chickens interact as they establish their place in the group.',
      },
      {
        title: "Dust baths aren't dirty",
        text: "Chickens roll around in loose dirt or dust to help maintain their feathers and manage excess oils and parasites. It might look messy, but it's a natural grooming behaviour!",
      },
      {
        title: 'Built-in egg timers',
        text: "A hen's body forms an egg through a process that usually takes about 24–26 hours. The shell develops during the final stages before the egg is laid.",
      },
      {
        title: 'A bird with a memory',
        text: 'Chickens can learn from experience, recognize familiar faces, and remember where they have found food. They are much more observant than their reputation sometimes suggests.',
      },
    ],
  },
  {
    name: 'Duck',
    slug: 'duck',
    aboutHeading: 'Meet the Duck!',
    tagline: 'Made for life around water',
    description:
      'Ducks are waterfowl with waterproof feathers, broad bills, and feet adapted for swimming. Depending on the species, ducks eat a mix of aquatic plants, seeds, insects, and other small animals. Many domestic ducks descend from wild mallards.',
    facts: [],
    nuggets: [
      {
        title: 'Waterproof feathers',
        text: 'Ducks groom their feathers and spread oil from a gland near their tails. This helps keep their outer feathers water-resistant and their bodies insulated.',
      },
      {
        title: 'Feet like paddles',
        text: 'Many ducks have webbed feet that push against water, helping them swim efficiently. Their feet also help support them as they walk on land.',
      },
      {
        title: 'A bill made for feeding',
        text: "A duck's bill helps it gather and sort food. Some ducks strain tiny food particles from water, while others graze or dabble in shallow areas.",
      },
      {
        title: 'Ducks have excellent insulation',
        text: 'Their feathers trap air close to their bodies, helping them stay warm in cool water. Their legs also have adaptations that reduce heat loss.',
      },
      {
        title: 'Not every duck says "quack"',
        text: 'Ducks have many different calls, including whistles, grunts, and softer contact sounds. The familiar loud quack is especially associated with female mallards.',
      },
    ],
  },
]

export const ANIMALS: AnimalContent[] = ANIMAL_DEFINITIONS.map(buildAnimal)
