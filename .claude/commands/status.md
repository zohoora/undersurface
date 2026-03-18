Check the status of all UnderSurface services and report a concise table.

Check:
1. Firebase Hosting — is the site accessible? `curl -s -o /dev/null -w "%{http_code}" https://undersurface.me`
2. Cloud Functions — are they deployed? `firebase functions:list 2>&1`
3. Git status — any uncommitted changes? `git status --short`
4. Latest commit — `git log --oneline -3`
5. Tests — do they pass? `npm run test 2>&1 | tail -5`
6. Build — does it build? `npx tsc --noEmit 2>&1 | tail -3`

Present as a status table with service name, status (pass/fail), and details.
