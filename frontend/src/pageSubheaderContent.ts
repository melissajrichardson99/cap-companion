// Static subheader copy shown under each guest-facing page's .cap-sign-board
// title (Contact Staff is a popup, not a page, so its copy renders inside
// that modal's own header instead). No admin UI/DB table by design -- same
// "Melissa edits these values directly" pattern as homePageContent.ts/
// foodTruckContent.ts. Staff Page is internal-only and deliberately has no
// entry here.

export interface PageSubheaders {
  home: string
  map: string
  bingo: string
  puzzles: string
  scoring: string
  hunt: string
  animals: string
  photo: string
  collectibles: string
  foodTrucks: string
  contactStaff: string
}

export const PAGE_SUBHEADERS: PageSubheaders = {
  home: "Your guide to a great day at Cobb's! Check today's schedule, discover what's happening around the park, and find everything you need for your adventure.",
  map: 'Explore the park and find your next adventure. See where your favourite animals, activities, games, and amenities are located.',
  bingo: 'Keep exploring, keep checking things off! Complete activities around the park to fill your card and see how many milestones you can reach.',
  puzzles: 'Put your brain to the test! Choose a puzzle, solve the challenge, and see how quickly you can make your way to the finish.',
  scoring: "Keep track of the competition! Choose a game, add your players, and let Cobb's keep score while you play.",
  hunt: "Keep your eyes open—there's plenty to discover! Find the hidden characters around the park and complete challenges along the way.",
  animals: "Meet the animals that call Cobb's home! Discover fun facts, learn something new, and explore photos of the animals you can see around the park.",
  photo: "See what other visitors are capturing at Cobb's. Browse today's photos, find your favourite, and cast your vote.",
  collectibles: "Collect your memories from around the park! Unlock badges, discoveries, and special collectibles as you explore Cobb's.",
  foodTrucks: "Hungry? We've got you covered! Browse today's food trucks and find something delicious for lunch, a snack, or a sweet treat.",
  contactStaff: "Need a hand? We're happy to help. Find out how to reach the Cobb's team during your visit.",
}
