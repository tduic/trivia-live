# Trivia Live (Host + Phones)

A free-to-run, host-controlled trivia game:
- 10 questions total
- Players answer on their phones
- Host marks Correct/Incorrect (1 point each)
- Q10 is **Final Jeopardy**: players wager up to their current score
- Host can **Generate Game** (10 medium Qs) via the Anthropic Claude API, then edit/replace questions

## 1) Local Run ("download + press run")

```bash
npm install
npm run dev
```
Open the URL shown in your terminal.

## 2) One-time setup (free)

### Firebase (Firestore)
1. Create a Firebase project
2. Enable **Firestore Database**
3. Paste `FIRESTORE_RULES.txt` into Firestore Rules
4. Create a **Web app** in Firebase and copy its config into `.env.local` (start from `.env.local.example`)

### Anthropic API
Create an Anthropic API key and set it as `ANTHROPIC_API_KEY` in `.env.local`.

**Important:** keep your API key server-side only (never expose it in browser code).

## 3) Deploy for free (Vercel)
1. Push this folder to GitHub
2. Import the repo in Vercel
3. Add env vars (same as `.env.local`) in Vercel project settings
4. Deploy

## Host flow
- Home → **Create New Game (Host)**
- In the room, click **Generate game** to pull 10 medium questions from Claude
- Edit/replace any question
- Click **Reveal & Open Answers** for each question; players submit
- Mark answers Correct/Incorrect as they arrive
- Question 10: Open wagers, then open final answers, then judge (adds/subtracts wager)

## Notes on security
This app is designed for a party game with friends. Firestore rules allow public reads and player submissions without authentication. For a more locked-down version, enable Firebase Anonymous Auth and restrict writes by `request.auth.uid`.
