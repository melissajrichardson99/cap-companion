// "Take Me There" card config (Map page) -- maps the 6 guest-facing key-spot
// buttons onto the existing map_nodes data. Frontend-only by design: these
// are a fixed set of 6 labels layered on top of the existing node/category
// data, not open-ended content, so a schema column would just be another
// place for this list to drift out of sync. Mapping reviewed against the
// live map_nodes table and confirmed with Melissa on 2026-08-20 -- see specific
// notes below before changing any of these lists.
import type { ReactElement } from 'react'
import type { MapNode } from './api'
import { FenceIcon, ForkKnifeIcon, JoystickIcon, StageIcon, StoreIcon, WashroomIcon } from './components/NavIcons'

export interface KeySpotCategory {
  key: string
  label: string
  icon: (props: { className?: string }) => ReactElement
  matches: (node: MapNode) => boolean
}

// Exact node-name allowlists for the categories that are a curated subset of
// (or cut across) the existing category field, rather than "all of an
// existing category" -- see the 'attractions' entry below for the one
// category that instead matches dynamically.
const FOOD_NODE_NAMES = new Set(['Critter Cafe', "Granny Ann's Kitchen", 'Sugar Shack'])
const GENERAL_STORE_NODE_NAMES = new Set(['General Store'])
const WASHROOM_NODE_NAMES = new Set(['Restrooms'])
const ANIMAL_SHOW_NODE_NAMES = new Set(['Animal Stage'])
// Confirmed with Melissa: general-admission animal pens only -- excludes
// "Wallaroos (viewing only)" (a no-entry viewing overlook, not a pen guests
// enter) and "Private Event Animal Space" (reserved for private events, not
// generally guest-accessible).
const ANIMAL_PEN_NODE_NAMES = new Set([
  'Alpacas/Sheep/Pigs',
  'Capybaras & Emus',
  'Goats',
  'Kangaroos/Wallaroos',
  'Small Animals',
])

export const KEY_SPOT_CATEGORIES: KeySpotCategory[] = [
  {
    key: 'washrooms',
    label: 'Washrooms',
    icon: WashroomIcon,
    matches: (node) => WASHROOM_NODE_NAMES.has(node.name),
  },
  {
    key: 'food',
    label: 'Food',
    icon: ForkKnifeIcon,
    matches: (node) => FOOD_NODE_NAMES.has(node.name),
  },
  {
    key: 'general_store',
    label: 'General Store',
    icon: StoreIcon,
    matches: (node) => GENERAL_STORE_NODE_NAMES.has(node.name),
  },
  {
    key: 'animal_pens',
    label: 'Animal Pens',
    icon: FenceIcon,
    matches: (node) => ANIMAL_PEN_NODE_NAMES.has(node.name),
  },
  {
    key: 'animal_shows',
    label: 'Animal Shows',
    icon: StageIcon,
    matches: (node) => ANIMAL_SHOW_NODE_NAMES.has(node.name),
  },
  {
    key: 'attractions',
    label: 'Attractions',
    icon: JoystickIcon,
    // Unlike the categories above, "Attractions" maps 1:1 onto the existing
    // 'attraction' node category rather than a curated subset -- matching
    // dynamically means a newly added attraction node is included
    // automatically instead of needing this file updated too.
    matches: (node) => node.category === 'attraction',
  },
]
