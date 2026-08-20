// Static content for the Food Truck Menus page (Plan.md build-priority item
// 4, last major unbuilt item). No admin UI/DB table by design -- same
// pattern as homePageContent.ts -- since real prices aren't finalized yet
// and this is informational-only. Melissa edits these values directly
// whenever menus/prices change.

export interface FoodTruckMenuItem {
  name: string
  // Omitted only for non-priceable entries -- Sugar Shack's Flavours side
  // box lists flavor choices for an already-priced Ice Cream item, not
  // separate purchasable items. Every real menu item carries a placeholder
  // CAD price (management hasn't finalized real numbers yet) so
  // FoodTruckScreen never has to special-case a priceless menu row.
  price?: string
}

export interface FoodTruckSideBox {
  title: string
  items: FoodTruckMenuItem[]
}

export interface FoodTruck {
  slug: string
  name: string
  tagline: string
  // Candidate real-photo paths (public/ root), tried in order before falling
  // back to photoPlaceholderSrc -- same fallback-chain technique as
  // animalContent.ts/AnimalImage, so a renamed/missing file degrades to the
  // placeholder instead of a broken image icon.
  photoCandidates: string[]
  // This truck's themed "Photo Coming Soon" SVG, used only once every real
  // candidate above has 404'd.
  photoPlaceholderSrc: string
  menuItems: FoodTruckMenuItem[]
  // Almost always one box (Drinks / Flavours), but Critter Cafe splits into
  // two side-by-side boxes (Hot Drinks + Snacks) -- hence an array rather
  // than a single { title, items } field.
  sideBoxes: FoodTruckSideBox[]
  // Critter Cafe only -- renders the "Fall Only" badge on its card.
  seasonal?: boolean
}

export const FOOD_TRUCKS: FoodTruck[] = [
  {
    slug: 'granny-anns-kitchen',
    name: "Granny Ann's Kitchen",
    tagline: 'Burgers, bites & all your favourites!',
    photoCandidates: ['/lunch_truck.png'],
    photoPlaceholderSrc: '/food-trucks/granny-anns-placeholder.svg',
    menuItems: [
      { name: 'Burger', price: '$7.99' },
      { name: 'Veggie Burger', price: '$7.99' },
      { name: 'Hot Dog', price: '$5.49' },
      { name: 'Corn Dog', price: '$5.49' },
      { name: 'Fries', price: '$4.49' },
      { name: 'Poutine', price: '$7.99' },
      { name: 'Chicken Fingers', price: '$8.99' },
      { name: 'Nachos', price: '$7.99' },
    ],
    sideBoxes: [
      {
        title: 'Drinks',
        items: [
          { name: 'Soft Drink', price: '$2.75' },
          { name: 'Bottled Water', price: '$2.25' },
          { name: 'Juice Box', price: '$1.75' },
        ],
      },
    ],
  },
  {
    slug: 'sugar-shack',
    name: 'Sugar Shack',
    tagline: 'Sweet treats to make your day!',
    photoCandidates: ['/dessert_truck.png'],
    photoPlaceholderSrc: '/food-trucks/sugar-shack-placeholder.svg',
    menuItems: [
      { name: 'Ice Cream Cone', price: '$4.49' },
      { name: 'Ice Cream Cup', price: '$4.49' },
      { name: 'Ice Cream Sandwich', price: '$4.99' },
      { name: 'Slushie', price: '$3.99' },
      { name: 'Cotton Candy', price: '$3.99' },
      { name: 'Mini Donuts', price: '$5.49' },
      { name: 'Freezie', price: '$1.75' },
    ],
    sideBoxes: [
      {
        title: 'Flavours',
        items: [
          { name: 'Vanilla' },
          { name: 'Chocolate' },
          { name: 'Strawberry' },
          { name: 'Mint Chocolate Chip' },
          { name: 'Bubblegum' },
        ],
      },
    ],
  },
  {
    slug: 'critter-cafe',
    name: 'Critter Cafe',
    tagline: 'Warm drinks & cozy snacks!',
    photoCandidates: ['/fall_truck.png'],
    photoPlaceholderSrc: '/food-trucks/critter-cafe-placeholder.svg',
    seasonal: true,
    menuItems: [],
    sideBoxes: [
      {
        title: 'Hot Drinks',
        items: [
          { name: 'Coffee', price: '$2.99' },
          { name: 'Hot Chocolate', price: '$3.49' },
          { name: 'Cappuccino', price: '$4.49' },
        ],
      },
      {
        title: 'Snacks',
        items: [
          { name: 'Popcorn', price: '$3.49' },
          { name: 'Chips', price: '$2.49' },
        ],
      },
    ],
  },
]
