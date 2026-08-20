// Static content for the FAQ page. No admin UI/DB table by design -- same
// "Melissa edits these values directly" pattern as homePageContent.ts/
// foodTruckContent.ts.

export interface FaqEntry {
  question: string
  answer: string
  // Present only on the Washrooms entry -- lets FaqScreen offer a direct jump
  // to the Map page's "Take Me There" > Washrooms highlight, using the same
  // key as keySpotCategories.ts's 'washrooms' category.
  keySpotKey?: string
}

export const FAQ_ENTRIES: FaqEntry[] = [
  {
    question: 'Where are your washrooms located?',
    answer:
      "As you're coming towards the food trucks, keep walking as you pass them, then turn left once you reach the far side of the party tent, then walk along that path until you see the washrooms (you can tap the Washrooms button under the map on our app for a visualization of the washroom's location).",
    keySpotKey: 'washrooms',
  },
  {
    question: 'Is outside food and drinks allowed in the park?',
    answer: 'Yes, feel free to bring anything you would like, just make sure not to feed the animals with outside food.',
  },
  {
    question: 'Where can I find a shady area?',
    answer: 'Our picnic tables near the food trucks will have umbrellas that can provide shade.',
  },
  {
    question: 'Are animals included with general admission?',
    answer:
      'Most of our animal experiences are included with general admission. You will be able to interact with, pet, and take photos with most of the animals here at the park. The only exceptions to this is a sloth encounter, a joey encounter (you can still pet them, but holding is a separate price), and a porcupine encounter.',
  },
  {
    question: 'Can I leave and come back?',
    answer: 'Yes, as long as you still have your wristband, you are free to re-enter the park at any time before we close at 5pm.',
  },
  {
    question: 'Where can I find the lost and found?',
    answer:
      'Items that have been lost during the current day will be brought to the ticketing entrance while items lost earlier in the season will be brought to our admin offices.',
  },
  {
    question: 'Where do I go for the tractor rides?',
    answer:
      'We have 2 locations for the tractor rides. One will be at the north-east corner of the park and will operate every hour on the half hour (11:30, 12:30, etc.). The other tractor ride station is at the south-east corner of the map and will operate every hour on the hour (12pm, 1pm, etc.). The last tractor rides will take place at 4:30pm for the east location and 4pm for the west location.',
  },
]
