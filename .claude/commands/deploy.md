Deploy UnderSurface to production.

1. Determine what changed by checking git status (src/, functions/src/, firestore.rules)
2. Run `npm run test` first — abort if tests fail
3. Build only what's needed:
   - If src/ changed: `npm run build`
   - If functions/src/ changed: `cd functions && npx tsc && cd ..`
4. Deploy only what's needed:
   - If src/ changed: `firebase deploy --only hosting`
   - If functions/src/ changed: `firebase deploy --only functions`
   - If firestore.rules changed: `firebase deploy --only firestore:rules`
   - If multiple changed: `firebase deploy`
5. After deploy, run `npm run smoke-test` to verify
6. Report what was deployed and smoke test results

If $ARGUMENTS contains "all", deploy everything regardless of what changed.
