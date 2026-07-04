// Firebase web-app config for list sync. This is PUBLIC by design
// (Firebase web configs are not secrets — Firestore security rules do
// the protecting). Empty until the Firebase project is created; the
// app's sync UI shows "not configured" while this is null.
//
// Setup (once, in the Firebase console — see README "List sync"):
//   1. Add project (e.g. "colorado-trails"), no analytics needed
//   2. Build > Authentication > enable Email/Password
//   3. Build > Firestore Database > create, production mode, us-central
//   4. Rules: see README snippet
//   5. Project settings > Add app > Web, copy the config object here
export const firebaseConfig = null
