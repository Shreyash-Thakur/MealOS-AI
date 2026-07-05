# MealOS AI — UX Principles

**Version:** 1.0  
**Status:** Canonical  
**Audience:** Product, Design, Engineering

---

## Governing Loop

Every screen in MealOS serves one of four phases. No screen is allowed to exist outside this loop.

```
Situation → Decision → Execution → Learning
```

MealOS is a Planning Engine. It is not a chat app. It does not have message history. It does not have chat bubbles. The UI is a Situation Board: cards appear progressively as agents complete their work, and the user reads a structured result — not a conversation transcript.

The product competes with human judgment. To win, it must feel faster, smarter, and more trustworthy than thinking it through yourself. Every UX decision must serve this benchmark.

---

## Section 1: The 12 UX Laws of MealOS

These are non-negotiable. Every design decision must comply with all twelve. When two laws appear to conflict, the lower-numbered law takes precedence unless documented otherwise.

---

### Law 1 — The 3-Question Limit

**Statement:** MealOS may ask no more than 3 clarifying questions per situation. All questions are presented simultaneously, never sequentially.

**Rationale:** Sequential questions impose conversational overhead and feel like an interrogation. Users who came to MealOS to save time are instead spending it answering a drip of questions one at a time. Batching questions communicates that the system has already thought through what it needs and is being efficient with the user's time. The 3-question ceiling forces the system to prioritize: ask only what the recommendation cannot be made without.

**What it forbids:**
- Follow-up clarification after the user answers the first batch ("One more thing...")
- More than one ClarificationCard per situation lifecycle
- Sequential question screens or multi-step clarification flows
- Asking for information the system already has in Memory (see Law 8)
- Open-ended question chains that depend on prior answers to determine the next question

---

### Law 2 — Never Block

**Statement:** The user must always see something meaningful on screen. Full-screen loaders, blank white screens, and indefinite spinners with no content are prohibited.

**Rationale:** A blocked screen communicates failure. Even when the system is working correctly, a blank screen creates doubt: "Did my input register? Did something crash?" Progressive disclosure — showing partial information as it becomes available — keeps users anchored to the process and informed that work is happening. The Planning Graph is the primary mechanism for this: agents report progress in real time, and the graph renders each node as it completes.

**What it forbids:**
- Full-screen loading overlays that obscure all content
- Displaying an empty Situation Board while waiting for the first agent to respond
- Spinner-only states for any operation that takes more than 500ms
- Removing rendered content from view while additional content loads
- Blocking the user from scrolling or reading partial results while agents are still running

---

### Law 3 — Always Show Progress

**Statement:** Every async operation has a visible, specific progress indicator. Skeleton loaders stand in for content areas. Planning Graph nodes animate per agent. Cooking step progress bars advance on each "Done" tap. No content area is empty and unsignaled during a loading state.

**Rationale:** Visible progress reduces perceived wait time. Research on loading UX consistently shows that users tolerate longer actual waits when they can see incremental progress. A skeleton loader that matches the shape of the incoming content primes the user for what they are about to see and communicates that the system knows what it is doing. An empty white rectangle communicates nothing and encourages abandonment.

**What it forbids:**
- Empty content containers without skeleton loaders
- Generic spinners that give no indication of what is loading or how long it will take
- Cooking step views that do not show which step the user is on out of the total
- Agent operations that run silently with no graph node or status update
- Suppressing progress indicators because the operation "usually finishes fast"

---

### Law 4 — Always Explain

**Statement:** Every recommendation includes a 1–3 sentence explanation from the Planning Agent. Every score in the Comparison Table has a readable label, not a raw number. The Confidence Score exposes its components. The "Why Not?" satisfies the user who chose the non-recommended path.

**Rationale:** Hidden intelligence feels untrustworthy. A score of 87 means nothing. "87/100: fits your ₹150 budget, matches your preference for North Indian, and Swiggy delivery is 22 minutes" means something. Users who understand why they are being recommended something are more likely to trust it, act on it, and return. Users who do not understand are more likely to override it, lose confidence, or churn. Visible intelligence is the product's premium differentiator.

**What it forbids:**
- Confidence Scores displayed as a number without component breakdown
- Comparison Table cells that show scores with no label
- Recommendations with no associated reasoning text
- The "Why Not?" section being absent when the user selects a non-winning column
- Explanation text that uses jargon, model internals, or technical parameter names

---

### Law 5 — Always Compare

**Statement:** MealOS always presents Cook, Order, and Dine options — even when one clearly wins. The Comparison Table is never collapsed to a single option. Users must always be able to see what they are passing on.

**Rationale:** A recommendation presented in isolation cannot be trusted. Trust requires comparison. When a user sees that Cook wins against Order by 12 points on budget, they understand and accept the recommendation. When Cook is presented alone as the only option, the user does not know if Order was even considered — and they are correct to be skeptical. Comparison also serves users who disagree with the recommendation: they have full information to make a different call.

**What it forbids:**
- Hiding the Comparison Table when one option scores significantly higher than others
- Greying out or removing columns for options that "obviously" don't apply
- Defaulting directly to a Recommendation Card without showing the Comparison Table
- Showing a single-option card labeled "Best for you" without alternatives
- Filtering out categories (Cook / Order / Dine) based on system assumptions without user input

---

### Law 6 — Execute in One Tap

**Statement:** The primary action — Order on Swiggy, Start Cooking, Book Table — is always one tap from the Recommendation Card. MealOS does not implement multi-step checkout flows.

**Rationale:** The Decision phase ends with a clear winner. The Execution phase begins immediately. Any friction between "I've decided" and "the action is initiated" erodes confidence and invites reconsideration. One tap means one tap: tapping "Order on Swiggy" initiates the Swiggy deep link or redirect immediately. Tapping "Start Cooking" immediately expands the step-by-step view. There is no confirmation modal, no summary screen, no re-entry of information the system already has.

**What it forbids:**
- Confirmation dialogs before initiating the primary action
- Multi-step flows within MealOS before handing off to Swiggy
- Collecting additional information (address, payment method) inside MealOS
- Primary action buttons that are disabled until the user confirms a secondary selection
- More than one tap required to reach any primary execution action from the Recommendation Card

---

### Law 7 — Never Say Sorry

**Statement:** Degraded states present alternatives, not apologies. When a service is unavailable or no perfect match exists, the system moves forward with the best available option and explains the substitution in plain language.

**Rationale:** Apologies are passive. "We're sorry, Swiggy is unavailable" terminates the user's session with MealOS and offers nothing. "Swiggy isn't available right now — here's a cook-only plan using what's nearby" continues the value delivery. The system exists to help users make a decision under real-world constraints. Real-world constraints include service outages, limited restaurant options, and incomplete pantry data. The system must handle all of these without transferring the problem back to the user.

**What it forbids:**
- Error messages that contain the word "sorry" or "apologize"
- States that show only an error with no forward path
- Removing a column from the Comparison Table without substituting its nearest available alternative
- Blocking the Recommendation Card because one data source is unavailable
- Displaying "No results" without offering the closest match and explaining why the exact match was unavailable

---

### Law 8 — Memory First

**Statement:** Before forming any clarifying question, the system checks Memory for a stored answer. Users who provided dietary preferences, allergy data, budget ranges, or location at any prior point are never asked again. Memory is the default; clarification is the exception.

**Rationale:** Repeating questions the user has already answered is one of the most trust-destroying behaviors an AI product can exhibit. It communicates that the system does not remember, does not care, or was not paying attention. A user who answered "I'm vegetarian" during onboarding should never encounter a clarification card asking about meat dishes. Memory is not a premium feature — it is a baseline obligation. The ClarificationCard's 3-question limit (Law 1) is made achievable precisely because Memory handles the rest.

**What it forbids:**
- Asking for dietary preference in a ClarificationCard when it exists in Memory
- Asking for budget when a budget range was set during onboarding or any prior session
- Asking for location when the system has a stored or device-inferred location
- Treating Memory as a "nice to have" that falls back to asking questions when uncertain
- Surfacing clarification questions for data points that can be inferred from recent history

---

### Law 9 — The 6-Second Promise

**Statement:** From situation submitted to full recommendation visible: under 6 seconds on a 4G connection (20–40 Mbps). Any individual agent step taking more than 2 seconds must show a specific progress indicator. The Planning Graph makes the wait feel active, not passive.

**Rationale:** The product competes with human judgment. Human judgment is instant. A user who thinks "what should I eat?" and reaches a conclusion in 4 seconds will not use a tool that takes 30 seconds. The 6-second target is aggressive because it has to be. The Planning Graph is not a cosmetic feature — it is a UX mechanism that converts 6 seconds of wait time into 6 seconds of visible, meaningful activity. Each agent node that lights up is a signal of progress. The user arrives at the recommendation having watched it be built, which reinforces confidence in the result.

**What it forbids:**
- Any situation → recommendation flow that consistently exceeds 6 seconds on a 4G connection
- Agent steps that take more than 2 seconds without a visible per-step indicator
- Using the Planning Graph as a purely decorative animation disconnected from real agent state
- Suppressing the 6-second target for "complex" situations without a documented exception and a user-visible warning ("This one might take a moment...")
- Spinning loaders that replace the Planning Graph during degraded performance

---

### Law 10 — Mobile-First Execution

**Statement:** The primary use case is a user on their phone deciding what to eat. Every interactive tap target is at minimum 44×44 pixels. No primary function relies on hover state. Swipe gestures are used where they match natural mobile navigation patterns.

**Rationale:** Food decisions happen in context: standing in a grocery store, sitting on a couch, waiting for the bus. The device in that context is a phone. A UI that is technically responsive but was designed for desktop — with small tap targets, hover-dependent tooltips, and click-heavy navigation — fails the primary user in the primary moment. 44×44px is the Apple Human Interface Guideline minimum for tap targets and is a non-negotiable floor, not a recommendation.

**What it forbids:**
- Tap targets smaller than 44×44px for any interactive element
- Tooltips that appear only on hover and carry information not available elsewhere
- Navigation patterns that require right-click or two-finger tap to access primary functions
- Designs that are approved only in desktop viewport and "responsive-ified" after the fact
- Any primary action that cannot be completed with one thumb on a standard phone screen

---

### Law 11 — Voice is Peer to Text

**Statement:** Anything the user can type, they can say. Voice input produces identical results to text input. The microphone button is the same visual prominence as the text input field and submit button. Voice is never labeled, treated, or styled as a secondary or experimental feature.

**Rationale:** Food decisions happen when hands are occupied: cooking, eating, holding bags. Voice is not an accessibility add-on for MealOS — it is a primary input mode for a significant portion of situations. Treating voice as secondary (smaller button, "beta" label, limited functionality) sends a signal that the product does not believe in it, which undermines adoption. Full feature parity between voice and text is the only acceptable standard.

**What it forbids:**
- A microphone button that is visually smaller or less prominent than the text submit button
- Voice input that is routed to a different processing path than text input
- Features or quick-tap chips that are accessible by text but not by voice
- Any "voice beta" or "experimental" labeling on voice functionality
- Situations where voice input produces a different or reduced recommendation compared to identical text input

---

### Law 12 — Situation Templates are Training Wheels

**Statement:** The quick-tap chip row ("I'm sick", "I'm broke", "Plan a date") exists to show users what the system can handle — not to define the full scope of the product. Chips feel like examples. The free-text input is always visually primary.

**Rationale:** New users do not know what to say to a planning engine. Chips solve the blank-canvas problem and demonstrate the system's range with zero friction. But chips become a ceiling if the UI makes them feel like the complete menu. The free-text input must always be visually dominant, always focused on load, and always feel more capable than the chips. A user who has used MealOS 10 times should be writing their own situations, not selecting from chips.

**What it forbids:**
- Chips that occupy more vertical space than the text input field
- Chip rows that push the text input below the fold on any mobile viewport
- Designs where chips are presented as the primary interaction and text is secondary
- More than 6 chips visible at once (cognitive overload; the list should not feel exhaustive)
- Chip labels that use product terminology or shorthand not understandable to a new user

---

## Section 2: Screen-by-Screen UX Rules

---

### Onboarding (5 Questions)

Onboarding is the only moment in MealOS where the user provides structured profile data. It sets Memory. Everything after it should feel easier because of what was collected here.

**One question per screen.** Never stack all 5 questions on a single page. Each screen is a single question with a single answer mechanism. The cognitive cost of one question is nearly zero; the cognitive cost of a form is high.

**Progress is always visible.** A step indicator (1/5, 2/5...) is present on every onboarding screen. Users must always know how far they are and how far remains. No progress indicator = no trust that it will end.

**Skip is unavailable for required fields.** Diet and allergy information are required. These fields power every recommendation. A user who skips them receives a permanently degraded product. The Skip button does not exist for these fields. Optional fields (cuisine preferences, household size) may have a "Skip for now" that stores a null and can be completed later from the Memory Panel.

**Time expectation is set upfront.** The first onboarding screen states: "Takes about 90 seconds." This is not a promise to optimize for — it is a commitment to keep. If onboarding expands beyond 90 seconds in user testing, a question must be removed or made optional, not the estimate adjusted.

**Zero jargon.** Question phrasing uses the language a person uses when talking to a friend, not the language of a nutritionist or a database form. "Do you avoid any foods for health or personal reasons?" not "Select applicable dietary restrictions." "How many people are you usually feeding?" not "Specify household size."

---

### Situation Input (Home)

The home screen is where the Situation phase begins. Its sole job is to get the user from "I have a food problem" to "the system is working on it" as fast as possible.

**Search field is focused on load.** When the user opens MealOS, the cursor is in the input field. No tap required to begin typing. The keyboard is raised on mobile immediately. Zero friction to the first character.

**Placeholder text rotates every 4 seconds.** The placeholder cycles through real example situations: "I'm exhausted and have eggs and bread at home", "Planning a birthday dinner for 6 under ₹3000", "I need something healthy that delivers in 20 minutes." Each example is a real situation, not a prompt format tutorial. The rotation is slow enough to read; fast enough to expose range.

**Voice button is equal prominence to submit.** The microphone icon and the submit button (arrow or "Go") are the same size, the same visual weight, and adjacent to each other. Neither is styled as primary.

**Quick templates are chips below the input.** The chip row is below the input, not above it, not beside it. The chips are secondary in layout to the text input. Maximum 6 chips visible. Horizontal scroll for additional chips is acceptable; a second row is not.

**Submit on Enter (keyboard) and on "Go" tap (mobile).** Two submission paths. No submit button hidden behind a tap on mobile. No requirement to dismiss the keyboard before submitting.

**Character limit: 500.** The input accepts up to 500 characters. At 400 characters, a counter appears showing remaining characters. At 500, further input is blocked and a gentle message suggests the user has provided enough for a good recommendation.

---

### Situation Board (Active)

The Situation Board is the core of the Decision phase. It is a board of cards, not a chat thread. Cards render as agents complete work. The user reads a progressively assembled view, not a conversation.

**ConfidenceCard appears within 1 second.** Within 1 second of situation submission, a ConfidenceCard renders with an initial confidence score and the components the system is using. This card may be incomplete — it updates as agents report back — but it must be visible within 1 second. The user sees evidence of progress immediately.

**ClarificationCard appears before the PlanningGraph starts.** If the system needs clarification, the ClarificationCard renders and the PlanningGraph does not animate until the user responds. Questions first. The user must not feel that the system is already working on a plan before they have answered the clarifying questions.

**PlanningGraph nodes animate per SSE event.** Each agent's completion triggers an SSE event. Each SSE event animates the corresponding node on the Planning Graph. The animation is the progress indicator. Nodes do not all appear at once.

**No action buttons are visible until `plan_ready`.** The Comparison Table and Recommendation Card are not rendered until the system emits a `plan_ready` event. Before that, the board shows ConfidenceCard, ClarificationCard (if applicable), and the PlanningGraph. No premature action affordances.

**SSE disconnect handling.** If the SSE connection drops, the board immediately displays a reconnection indicator ("Reconnecting...") without wiping the board state. Rendered cards persist. On reconnect, the stream resumes from the last emitted event. If reconnect fails after 10 seconds, a manual "Try again" button appears.

---

### Comparison Table

The Comparison Table is where the Decision is made visible. It is not a summary. It is a scoring surface.

**Cook column is always leftmost.** Cook is the leftmost column in every rendering. This is a product position: cooking is the thinking person's choice, the option that saves money, builds skill, and uses what's already at home. Placing it first is a statement of values, not a score-dependent sort.

**The winning column has an accent border highlight.** The recommended column is visually distinguished with the accent color border on all four sides. The label "Recommended" appears above the column header. This is the only visual differentiation; the other columns are not greyed out or diminished.

**Switching the active column re-explains the winner.** If the user taps a non-recommended column to make it active, the explanation text beneath the table updates to explain why that column was ranked where it was. This satisfies the "Why Not?" need inline, without requiring a separate screen.

**Mobile: horizontal swipe to navigate columns.** On mobile viewports where all three columns cannot be visible simultaneously, the table is horizontally scrollable with swipe gestures. A tab row (Cook / Order / Dine) above the table serves as a fixed navigation. The active tab scrolls the table to the corresponding column.

---

### Recommendation Card

The Recommendation Card is the culmination of the Decision phase and the start of the Execution phase. Its layout prioritizes the action above everything else.

**Primary action button is the bottom-most, widest element.** Regardless of screen height or content length, the primary action button (Order on Swiggy / Start Cooking / Book Table) is pinned to the bottom of the card. On mobile, this means it is within thumb reach. It is full-width. It is the last thing the eye lands on when reading down.

**YouTube card appears before cooking steps.** When the recommendation is to cook, the relevant YouTube video card renders above the step-by-step instructions. The video sets context — the user sees what they are making before they read how to make it. The video card is not a full embed by default; it is a thumbnail + title + duration. Tapping it opens the video.

**Instamart cart summary precedes the "Add to Instamart" button.** Before the user taps "Add to Instamart", they see: the list of items, a total cost, and an estimated delivery time. The button is below this summary. There is no "trust me, tap and see what happens" moment.

**Cooking steps are collapsed by default.** The step list renders collapsed with only the first step preview visible. Tapping "Start Cooking" expands all steps and the progress bar appears. This prevents overwhelming the user before they have committed to cooking.

---

### Memory Panel

The Memory Panel is where the Learning phase is visible to the user. It is a record of what the system knows about them and where that knowledge came from.

**Every fact shows its source.** Three possible sources: "Onboarding" (set during initial setup), "Stated by you" (said during a clarification or explicitly), "Learned from use" (inferred from patterns). The source label appears alongside every fact. This is not decorative — it tells the user how confident to be in the fact and how to correct it.

**Editing is always available.** No fact is locked. Every fact has an edit affordance. The system has no facts that are "system-managed" and cannot be changed by the user. The user owns their Memory.

**Deletion asks a specific question.** When the user deletes a fact, the confirmation reads: "Are you sure? We'll ask you about this next time." — not a generic "Are you sure you want to delete?" This communicates the consequence clearly: the system will need to ask again, and the user should decide whether that is acceptable. The specific consequence is more informative than the generic confirmation.

**Changes take effect immediately.** All edits and deletions apply optimistically. The UI updates before the server confirms. If the server rejects the change (rare), the UI reverts and shows a one-line error. No "Saving..." states for individual fact edits.

---

## Section 3: Micro-interaction Specification

Each specification follows the format: **Trigger → Animation → Feedback → Result**

---

**1. Chip tap (quick template)**

Trigger: User taps a quick template chip.  
Animation: Chip background fills with accent color over 120ms (ease-out). Chip text color inverts. Chip scale pulses to 1.04 and returns over 80ms.  
Feedback: The text input field populates with the chip's full situation text (not just the label). The character count updates. Keyboard does not raise automatically — user has the option to edit or submit as-is.  
Result: Text input contains the template situation. Submit button is enabled. User may edit the text, tap another chip (which replaces the current text), or submit.

---

**2. Voice button tap → listening**

Trigger: User taps the microphone button.  
Animation: Microphone icon transitions to a pulsing waveform icon over 200ms. The input field placeholder text is replaced with "Listening..." The button background dims slightly to indicate an active state.  
Feedback: The system requests microphone permission on first use (browser/OS prompt). On subsequent uses, listening begins immediately with no prompt. A soft audio cue (optional, respects system silent mode) indicates listening has started.  
Result: The system is in active voice capture mode. Ambient sound is being captured and processed. The waveform pulses with detected audio amplitude.

---

**3. Voice recognition complete → text appears in input**

Trigger: User stops speaking and the recognition result is finalized (either via voice-end detection or a manual stop tap).  
Animation: Waveform icon transitions back to the microphone icon over 150ms. Transcribed text types into the input field over 300ms (characters appear progressively, not all at once).  
Feedback: If confidence in the transcription is below threshold, a "Did you mean...?" alternative appears below the input for 4 seconds before auto-dismissing. No error sound; the transcription always appears even at low confidence.  
Result: Input field contains the transcribed text. User may edit or submit. The field is focused and cursor is placed at the end of the transcribed text.

---

**4. Submit situation → Confidence Card appears**

Trigger: User taps submit or presses Enter with a situation in the input field.  
Animation: The input field and chip row slide upward and fade out over 200ms. The Situation Board fades in over 300ms. The ConfidenceCard animates in from below (translate-y: 20px → 0, opacity: 0 → 1) over 250ms.  
Feedback: The ConfidenceCard shows an initial confidence score with the components the system has already assessed (Memory data). The Planning Graph appears with all nodes in a "pending" state (grey, unfilled).  
Result: Situation Board is active. ConfidenceCard is visible. System is processing. If clarification is needed, ClarificationCard renders next (before any graph nodes animate).

---

**5. Clarification question answer tap**

Trigger: User taps one of the quick-tap options in the ClarificationCard, or submits a free-text answer.  
Animation: The selected option fills with accent color over 100ms. The other options fade to 50% opacity. A checkmark appears on the selected option. The ClarificationCard footer shows "Got it" and the card begins to collapse after 600ms.  
Feedback: ConfidenceCard score updates immediately to reflect the new information. The score change is animated (count-up or count-down over 400ms).  
Result: Answers are submitted. Planning Graph begins animating. Nodes start completing in sequence. ClarificationCard collapses fully and disappears from the board.

---

**6. Planning Graph node completing**

Trigger: SSE event received indicating an agent has completed its task.  
Animation: The corresponding node's ring fills with accent color (circular fill animation, clockwise, over 300ms). The node icon animates from grey to white. A subtle pulse radiates from the node outward and fades.  
Feedback: The node's label text updates from the agent name to the key output (e.g., "Budget Agent → ₹150 limit confirmed"). The next dependent node's ring begins a slow pulsing animation to indicate it is now in progress.  
Result: Completed node is in a "done" state. Progress is visible. If this is the final node, the Comparison Table renders below the Planning Graph.

---

**7. Comparison column switch**

Trigger: User taps a non-active column header or swipes to a different column on mobile.  
Animation: The accent border slides from the current column to the tapped column over 200ms (border-color fade out on old, fade in on new). The "Recommended" label repositions. The explanation text beneath the table cross-fades over 150ms.  
Feedback: The explanation text updates to describe the selected column's reasoning. If the selected column is not the recommended one, a "Why we recommend [other option] instead" link appears at the bottom of the explanation.  
Result: The user's selected column is now visually active. The explanation text reflects the selected column. Primary action button below the table updates to match the active column's action.

---

**8. Plan Simulator toggle open**

Trigger: User taps the "Simulate" or "What if?" button on the Recommendation Card.  
Animation: A bottom sheet slides up from below the screen over 300ms (cubic-bezier ease). The sheet overlays the bottom 60% of the screen. Background dims with a 30% opacity dark overlay.  
Feedback: The sheet contains adjustable parameters (budget slider, time available, dietary filters) with their current values pre-populated from the active plan. Each adjustment immediately re-runs a lightweight recalculation and updates the displayed scores in the background.  
Result: Plan Simulator is open and interactive. Changes made in the simulator update the scores in real time. A "Apply changes" button confirms the simulation as the new active plan. Tapping outside the sheet or dragging it downward closes it without applying changes.

---

**9. "Add to Instamart" tap → redirect**

Trigger: User taps the "Add to Instamart" button on the Recommendation Card.  
Animation: Button text changes to "Opening Swiggy Instamart..." with a spinner replacing the leading icon. Button is disabled immediately to prevent double-tap.  
Feedback: A toast notification appears at the top: "Taking you to Instamart with [N] items ready in your cart." The toast persists for 3 seconds.  
Result: After 800ms (to allow the animation to complete), the browser navigates to the Swiggy Instamart deep link with the cart pre-populated. If the deep link fails (app not installed, URL malformed), the toast updates to "Couldn't open Instamart automatically — [Open manually]" with a fallback URL.

---

**10. Cooking step "Done" tap → progress bar updates**

Trigger: User taps "Done" on a cooking step to mark it complete.  
Animation: The step's checkbox fills with accent color over 150ms. The step text gains a strikethrough that draws left-to-right over 200ms. The step card's background color softens to a muted version of the background. The progress bar at the top of the cooking view fills by one segment over 300ms.  
Feedback: The next step card pulses once with a 1.02 scale bounce to draw the user's eye. If this is the last step, the progress bar fills completely and a "Done! How was it?" prompt animates in from below.  
Result: Step is marked complete. Progress bar reflects the new state. User's position in the recipe is preserved — returning to the app brings them back to the current step.

---

**11. Memory fact edit → inline edit mode**

Trigger: User taps the edit icon on a Memory Panel fact.  
Animation: The fact row expands vertically to reveal an input field pre-populated with the current value. The edit icon changes to a checkmark (confirm) and an X (cancel). Other rows dim to 70% opacity to focus attention on the active edit.  
Feedback: The input is focused immediately. On mobile, the keyboard raises and the active row scrolls to remain visible above the keyboard.  
Result: User is in inline edit mode for that fact. Tapping the checkmark saves immediately (optimistic update). Tapping X cancels with no change. Pressing Enter on keyboard saves. The other rows return to full opacity after the edit is confirmed or cancelled.

---

**12. Toast notification auto-dismiss**

Trigger: A toast notification has been visible for its full display duration (default 3 seconds; 5 seconds for error toasts).  
Animation: The toast translates upward 8px and fades to 0 opacity over 300ms (ease-in).  
Feedback: No sound. No haptic. The dismiss is silent. If the user has interacted with the toast (tapped a link within it), the toast dismisses immediately on that tap rather than waiting for the timer.  
Result: Toast is removed from the DOM. No empty space remains where the toast was — the toast is absolutely positioned and does not affect document flow.

---

## Section 4: Error and Empty State Rules

Every error state in MealOS follows a three-part pattern:

1. **What happened** — one sentence, plain language, no jargon, no apology
2. **What the system is doing about it** — the automatic fallback, stated explicitly
3. **One manual action** — offered only if the user can meaningfully intervene

---

### Error States

**Swiggy unavailable**

What happened: "Swiggy isn't responding right now."  
What the system is doing: "Showing you a cook-only plan using ingredients near you."  
Manual action: "Try Swiggy again" button (re-attempts the Swiggy API call without reloading the full plan).  
Rendering note: The Order column in the Comparison Table is replaced with a greyed-out "Swiggy unavailable" state. The Cook column is promoted as the active recommendation automatically. The Recommendation Card reflects the cook plan.

---

**No restaurants match filters**

What happened: "No restaurants nearby match your filters right now."  
What the system is doing: "Showing you the closest match — [Restaurant Name], which meets [N of M] of your criteria."  
Manual action: "Relax filters" button that removes the lowest-priority filter (as determined by user preferences) and re-queries.  
Rendering note: The closest-match restaurant is shown with a clear label indicating which criteria it misses. The user can see exactly what was compromised.

---

**LLM timeout (plan taking more than 8 seconds)**

What happened: "This one's taking longer than usual."  
What the system is doing: "We'll show you what we have so far and fill in the rest as it arrives."  
Manual action: "Start over with a simpler situation" link (navigates back to home with current situation pre-populated in the input for editing).  
Rendering note: The Comparison Table renders with whatever agent data has returned. Any columns with missing data show skeleton loaders rather than error states. The ConfidenceCard updates its score downward and shows "Partial data" as a component.

---

**No Instamart items available for recipe**

What happened: "Instamart doesn't have everything for this recipe right now."  
What the system is doing: "Here are the items that are available. You can get the rest from a nearby store."  
Manual action: "Show me what's missing" — expands a list of unavailable items with suggested alternatives from Instamart or nearby supermarkets.  
Rendering note: The "Add to Instamart" button changes to "Add available items to Instamart ([N] of [M])". The missing items list is collapsed by default.

---

**User offline**

What happened: "You're not connected to the internet."  
What the system is doing: "Showing your last saved plan from [time]."  
Manual action: "Retry connection" button that checks connectivity without navigating away.  
Rendering note: A persistent top banner (not a toast) shows the offline state for the duration of the session. The banner dismisses automatically when connectivity is restored. The last saved plan is rendered in a clearly labeled "Offline — last saved" state.

---

**Clarification timeout (user leaves without answering)**

What happened: (No explicit error shown — the session is simply inactive.)  
What the system is doing: On return, the Situation Board is restored exactly as the user left it. The ClarificationCard is still visible and waiting. A subtle "Still there? Your questions are waiting." prompt appears after 2 minutes of inactivity.  
Manual action: "Start fresh" link on the inactivity prompt that navigates back to home.  
Rendering note: The session state is preserved in local storage. The user can return from a background tab, from lock screen, or from another app and find the board exactly as they left it.

---

**Invalid situation (not food-related)**

What happened: "That doesn't look like a food situation."  
What the system is doing: Showing a single inline message below the input field — no navigation, no full error screen.  
Manual action: The input field remains active. A chip row below the error message shows relevant examples: "Try: 'I'm hungry and have 30 minutes'".  
Rendering note: This is a validation message, not a crash. The user should feel gently redirected, not rejected. The message appears below the input, the cursor stays in the input, and the user can edit and resubmit immediately.

---

### Empty States

**No history (first-time user on history tab)**

This state must make the user feel possibility, not absence. Display: "Your plans will appear here. Start with a situation to build your history." Below the message, a single "Plan something now" button navigates to the home screen. Do not show an empty list skeleton. Do not show a generic empty-box illustration.

---

**Empty pantry**

Display: "Your pantry is empty. Add ingredients you have at home and we'll factor them into every plan." Below the message: an "Add ingredients" button and a "Learn why this helps" expandable section (one paragraph explaining how pantry data improves recommendations). This state is an opportunity, not a failure — communicate it as such.

---

**Memory panel with no facts**

This state should never occur after onboarding is complete. If it does, it indicates a data loss event. Display: "We seem to have lost track of your preferences. Let's get them back." Below: a "Restore from onboarding" button that re-runs the onboarding flow. Do not present this as a normal empty state — it is an anomaly, and the language should reflect that something unexpected happened while remaining calm.

---

## Section 5: Accessibility Rules

Accessibility in MealOS is not a checklist item appended at the end of development. It is a constraint applied at the design phase, verified in engineering, and tested with assistive technology before any feature ships.

---

### Keyboard Navigation

All interactive elements are reachable via Tab key in logical reading order. The Tab sequence follows visual reading order (top-to-bottom, left-to-right within sections). No interactive element is keyboard-inaccessible. No focus trap exists except within modal overlays and the Plan Simulator sheet (where trapping is intentional and an Escape key exits).

The chip row supports left and right arrow key navigation between chips. Enter or Space activates the focused chip. Home and End keys move to the first and last chip respectively. This arrow-key navigation is announced to screen readers via `role="listbox"` and `role="option"` semantics.

---

### Live Regions and Screen Reader Announcements

The Planning Graph is the most dynamic element in the application. Each graph node is wrapped in an `aria-live="polite"` region. When a node completes, the announcement reads: "[Agent name] complete — [key output]." For example: "Budget Agent complete — ₹150 limit confirmed." The `polite` value ensures announcements do not interrupt an in-progress screen reader utterance.

The ConfidenceCard score update is announced via an `aria-live="polite"` region scoped to the score element. The full readable string is: "AI Confidence: [score] percent. [Component 1]. [Component 2]. [Component 3]." For example: "AI Confidence: 92 percent. Budget known. Preferences known. Location assumed."

All async content insertions — the ClarificationCard appearing, the Comparison Table rendering, toasts — use `aria-live` regions to notify screen reader users without requiring focus movement.

---

### Contrast and Theming

The minimum contrast ratios are enforced across all 5 MealOS themes:

- Body text (below 18px, non-bold): 4.5:1 minimum against background
- Large text (18px+ or 14px+ bold): 3:1 minimum against background
- UI components and interactive boundaries: 3:1 minimum against adjacent colors
- Disabled elements are exempt from contrast requirements but must not be the only way to access a function

Contrast ratios are verified programmatically in CI using a contrast audit script run against all theme token combinations. No theme ships with a failing contrast ratio.

---

### Focus Indicators

Focus indicators are never removed. The browser default `:focus` outline is not suppressed with `outline: none` without an equivalent custom replacement. The focus indicator for all interactive elements uses the `--accent` CSS variable as its color, with a 2px solid outline and 2px offset. On dark backgrounds, the outline gains a 1px white inner ring to ensure visibility.

Focus indicators are visible on all 5 themes. This is verified in CI alongside contrast ratios.

---

### Touch and Motion

All touch targets are at minimum 44×44 pixels (physical size, accounting for device pixel ratio). This is enforced at the component level for all interactive primitives (Button, Chip, IconButton, Step, TabItem).

For users with `prefers-reduced-motion: reduce` set at the OS level, all transition animations are reduced to simple opacity fades (150ms maximum). The Planning Graph node animations are reduced to immediate state changes (no fill animation, no pulse). The toast slide animation is replaced with a fade. No functionality is lost under reduced motion.

---

## Section 6: Conversation Design Principles

MealOS asks questions. The quality of those questions determines whether the product feels like a colleague or a bureaucrat. Tone is a product decision, not a copywriting detail.

---

### Voice and Register

Questions are written in first-person plural where possible. "Are we talking dinner tonight or planning for the week?" treats the system and user as collaborators in the same situation. Clinical phrasing ("Please specify your budget range") positions the system as a form. Over-casual phrasing ("Hey! What's your vibe? 🍕") undermines the premium positioning and reads as performative. The target register: a knowledgeable friend who respects your time and speaks directly.

**Directness is respect.** A question that gets to the point without hedging ("What's your budget tonight?") is more respectful of the user's time than a softened version ("We were wondering if you might be able to share roughly what kind of budget range you're working with, if that's okay?"). Users are adults. Ask directly.

---

### Option Labeling

Quick-tap options in ClarificationCards use natural language. "Under ₹200" not "BUDGET_TIER_1". "Just for me" not "single_user". "Tonight" not "current_meal". Labels must be immediately understandable to a new user who has never seen MealOS before. If a new user would have to think about what an option means, the label is wrong.

---

### Assumption Statements

When the system infers a value and wants light confirmation, the phrasing is: "Assuming [assumption] — is that right?" followed by a "Yes, that's right" and "No, change this" pair. For example: "Assuming you're cooking for one — is that right?" This pattern is more efficient than asking an open question and signals that the system has already done the work of making a reasonable guess.

---

### Question Type Selection

Never ask a yes/no question when a multiple-choice option covers the decision space better. "Are you vegetarian?" is a worse question than "Any foods you avoid?" with options: "Meat and fish", "Just red meat", "Eggs and dairy too", "None — I eat everything". The multiple-choice version gathers more information in the same interaction and handles edge cases the yes/no cannot.

When a yes/no is the correct format (confirming a single fact, not gathering preferences), it may be used. The threshold: if the answer "yes" and the answer "no" lead to meaningfully different follow-up actions, it is appropriate. If "no" just leads to another question about what the correct answer is, use a multiple-choice instead.

---

### Examples of Correct and Incorrect Phrasing

| Situation | Wrong | Right |
|---|---|---|
| Asking about budget | "Please specify your budget range." | "What's your budget tonight?" |
| Asking about diet | "Select applicable dietary restrictions." | "Any foods you avoid?" |
| Assumption confirmation | "Is our assumption that you are dining alone correct?" | "Assuming you're eating solo — is that right?" |
| Time available | "How many minutes do you have available for meal preparation?" | "How much time do you have?" |
| Meal type | "Specify meal occasion." | "Is this for dinner tonight or are we planning ahead?" |
| Group size | "Enter number of diners." | "Just you, or feeding more people?" |

---

*This document governs all UX decisions in MealOS. Changes to any rule require written rationale and must be reviewed against the product's core principle: the product competes with human judgment, and must feel faster, smarter, and more trustworthy than thinking it through yourself.*
