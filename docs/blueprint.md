# **App Name**: Seventeen

## Core Features:

- Time Manipulation: Implement a timing mechanism that subtly manipulates time using acceleration, skips, and micro-stutters to make accurate timing psychologically challenging.
- Anonymous Authentication: Utilize Firebase Authentication with anonymous sign-in to track users without requiring account creation.
- Result Display: Display results immediately after the user stops the timer, showing the stopped time, the difference from 17.00 seconds, and a feedback message based on proximity.
- Automatic Restart: Automatically restart the game after a brief result display to encourage repeated attempts.
- Data persistence: Leverage Firestore to persist timing results across sessions
- Aggregated Analytics: Calculate the aggregate average across all the players and display these stats at the end of each round to create a feeling of community.
- Rage message: If the player does not get the desired 17 seconds result, serve up a customized failure message.

## Style Guidelines:

- Background: Near-black with a subtle purple gradient from #05040b to #0b0614.
- Accent: Purplistic neon (used sparingly) to emphasize the counter and result state.
- Font: Use 'Space Grotesk' (sans-serif) for headlines and 'Inter' (sans-serif) for the display number to ensure high readability and a modern aesthetic. Note: currently only Google Fonts are supported.
- Center all elements vertically and horizontally on a single screen layout with no navigation bar or footer.
- Implement smooth and confident animations for the counter increment, avoiding playful styles. Subtle visual cues should reinforce tension without revealing time manipulation.