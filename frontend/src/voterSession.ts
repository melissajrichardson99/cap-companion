// Anonymous per-device voting id for Favorite Photo (Plan.md 2.14) -- not
// real auth, just enough to stop trivial double-voting from the same
// browser. Generated once and persisted in localStorage; the same id is
// sent with every gallery load (so voted_by_me reflects this device) and
// every vote request (so the backend's unique(submission_id,
// voter_session_id) constraint can catch a repeat).
const STORAGE_KEY = 'cap-voter-session-id'

export function getVoterSessionId(): string {
  let id = localStorage.getItem(STORAGE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, id)
  }
  return id
}
