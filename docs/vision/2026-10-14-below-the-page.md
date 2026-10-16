# UnderSurface — below the page

*An artistic direction, 14 October 2026. A proposal, not a description of shipped behavior.*

## The work I think is hiding here

**UnderSurface could be an instrument that turns private language into a place you can return to.**

A sentence has an underside. Two incompatible feelings can occupy the same place. Something you wrote in March can become visible through something you write in October. A photograph can sit beside a sentence for six months without either needing to explain the other.

The defining experience would be making something perceptible that was difficult to hold in words alone.

This is where I would take the psychedelic invitation: change the laws of the interface. Let time have depth. Let attention have distance. Let language become material. Let contradictions remain spatially possible. A saturated animated background would be a very small interpretation of that invitation.

The artistic test is demanding: **if every generated reply disappeared, would this still be somewhere worth spending time?**

The second test is equally important: does the world become recognizably *mine* through what I do in it, without requiring the system to declare who I am?

## What I actually explored

I read the current session shell, navigation, Journal and parts behavior, Room implementation and score contract, Field Mosaic, Ambiguity Prism, memory-boundary design, personal-parts design, atmospheric styling, and the recent remediation plans. I inspected the repository's existing promotional imagery as a visual reference. That imagery is historical material, not evidence of the current deployed interface. I did not complete an authenticated walkthrough of the live service; observations below are grounded in this checkout.

The most unusual ideas are already in the material:

| Existing material | The artistic possibility inside it | Source |
| --- | --- | --- |
| Ink changes with writing cadence; paragraphs settle | Writing leaves a physical trace | `src/extensions/inkWeight.ts`; `src/extensions/paragraphSettle.ts` |
| A pause can make room for something to appear | Absence is an interaction, without pretending a pause reveals a psychological fact | `src/engine/pauseDetector.ts`; `src/components/Editor/useJournalParts.ts` |
| Conversation can give way to sound and silence | An encounter can have a musical form | `src/components/Session/Room/RoomField.tsx`; `docs/superpowers/specs/2026-07-11-room-unified-experience.md` |
| Several interpretations can remain tentative or be rejected | Meaning can depend on the angle from which you look | `src/components/Session/AmbiguityPrism.tsx` |
| Private moments arrive from outside the app | A life can make an assemblage | `src/components/Session/FieldMosaic.tsx` |
| Fresh eyes excludes longitudinal memory in both directions | There can be a room where you are allowed to be unknown | `docs/superpowers/specs/2026-07-10-fresh-eyes.md` |
| Writer-confirmed names and a personal lexicon | The place can acquire a private vocabulary | `docs/superpowers/specs/2026-07-04-user-parts-model-design.md` |

These capabilities have feature flags and prerequisites. Their existence in source does not establish which ones are enabled for a particular live account.

The creative friction is that many of these ideas end up as a card, a dropdown, a rating, a toggle, or another paragraph. Field Mosaic asks for meaning and a connection. Prism asks for fit and correction effort. Those controls serve real purposes, but the accumulated experience risks becoming paperwork about an inner life.

I would preserve the writer's authority while giving that authority a more expressive form.

## One encounter, in full

It is late. You open a page. It does not ask you how you are.

You write:

> It was nice to see everyone.

You select the sentence. A small action appears: **Lift the sentence.**

The line stays readable. The paper opens beneath it, like the lining of a coat. In that space you write:

> I felt absent the whole time.

The interface does not call the second line the truth. The first may be true too. The underside is simply somewhere another thing can fit.

You choose **Stay with this.** The margin expands. The page becomes a room. The second sentence is suspended at the edge of a soft, imperfect oval of light. The letters remain ordinary letters. There is no cosmic narrator.

If you have invited speech, the companion might say, “We can leave both there.” Then it stops.

You move the sentence farther away. The visual field opens; an optional sound loses some of its closeness. Bringing it nearer makes the space more intimate. These are expressive controls you operate, not measurements of whether you are processing an emotion correctly.

After a while, you return. The exact page is there, in the exact place you left it. Both sentences remain.

You choose **Leave a trace.** A small fold is added to your private collection. It holds the two lines and their date. It has no “insight” written underneath.

Two weeks later you choose that fold again. You add:

> I think I was waiting for someone to notice.

Nothing congratulates you. You changed the object. That is enough.

The same grammar must work for delight. You write:

> We laughed until the soup went cold.

Underneath:

> Nobody remembers what was funny.

The fold opens the wrong way. A small silver spoon is enormous on the inside; the whole room is reflected in its bowl. You put the two sentences opposite each other and leave the middle empty. Months later, that empty middle is still the funniest part.

This could be a writer-chosen playful composition, with the spoon placed by the writer or offered as an editable invention. UnderSurface needs silliness, beauty, affection, boredom, and unfinished curiosity. A world made exclusively of distress would gradually teach people to look for distress.

## The three gestures I would build the work around

### Lift — a page with an underside

A selected line can hold another line beneath it. The relationship might be contradiction, elaboration, a memory, a joke, or something the writer cannot name yet. The app does not preassign the relationship.

There is no automatic excavation of hidden meaning. The writer decides what to lift and what to put there. A folded line has a quiet visible mark and a straightforward open action, so this remains discoverable without a tutorial or secret gesture.

The physical feeling matters: translucence rather than replacement, a crease rather than a modal, an opening rather than a new feed. Both layers stay editable and independently attributable. A plain text view shows the same paired passages with equal dignity.

### Inhabit — a sentence becomes a room

A writer-selected fragment becomes a short composition of space, optional sound, and potentially conversation. Room already provides the beginning of this grammar. Instead of choosing an unrelated preset and starting again, one brings a specific piece of the page into it.

**One impossible law: the inside can be larger than the outside.** Open the fold beneath three words and find a long room. A window at its far end looks back onto the sentence you are standing inside. Place two fragments together and the space between them becomes a third, blank surface you can write on. The architecture follows what you make, including arrangements that could never exist on paper.

This is the larger ambition beyond the first interaction study. The initial study establishes the physical grammar; a subsequent spatial experiment should test whether the impossible room can feel legible and surprising at once.

The fragment should influence the composition through explicit, understandable choices: the writer chooses close or distant, gathered or scattered, still or moving. Timing and visual structure can follow the length and cadence of the chosen words. None of these mappings should claim to reveal emotion from typing speed or physiology.

One movement should change one perceivable thing. A close/far gesture changes apparent depth and, when audio is enabled, apparent sonic distance. It should not silently change a profile, a diagnosis, or the companion's beliefs about the writer.

One coherent score coordinates the transition. The model can offer language; it does not own the clock, the exit, or the meaning of a gesture. **Return to the page** remains visible and immediate.

### Return — memory becomes something with a surface

The writer may keep a small trace of an encounter. A fold, a cut, an overlap, a notch: each is a record of an action, not a collectible awarded for attendance.

The trace keeps its shape when revisited. Later words can sit beside earlier words. The old statement does not disappear when a new statement arrives. The collection slowly becomes a material autobiography whose captions belong to its author.

This is where time gives the app its identity. A general chat can describe such an object. UnderSurface can preserve the object you made, the relationship you chose, the way you left it, and the experience of returning to it.

That advantage is experiential, not an absolute technical moat. Another product could reproduce it. The defensible creative work is the quality of the interaction and the accumulated, writer-authored history.

## How the world could become stranger over time

These are further behaviors of the same world, not a proposal for six more navigation tabs. Only the first three gestures belong in the initial experiment.

### A tide through time

The archive is a shallow depth rather than an endless chronological list. Moving through it changes which layers are visible. A phrase from last winter can show through a phrase from today, if the writer chooses to overlap them.

An association the system proposes appears as a loose thread. It becomes part of the arrangement only when the writer places it. Original words always open to their date and source. A model's summary is visibly a different material from a quotation.

The important event is not “we found your pattern.” It is: “I had forgotten that I said this.”

### A shore for things that have no explanation

A bus-window photograph. The words “the blue cup.” A short sound the writer deliberately records. A sentence from a session. These can sit together without a mandatory meaning field.

The writer places them, separates them, connects them, or leaves a space between them. Position initially means only position. If they decide that two objects belong together, the relationship can be named in their words—or left unnamed.

This extends Field Mosaic's underlying idea. New audio capture would be a new capability, not something the current SMS pipeline can be assumed to support.

### A prism you actually turn

In a redesigned prism, two readings of the same moment occupy translucent planes. Turning the object makes one easier to see while the other remains present. A third position holds both. The writer can erase every suggested reading and insert their own.

The point is not a fancier voting form. It is the physical experience of a situation changing when you change where you stand. Clear text controls offer the same choices without motion or dragging.

### A room for a life you did not live

An explicitly fictional annex: **Imagine one ordinary evening if…** The writer supplies the premise. The room is built from a handful of sensory details, with uncertain details left visibly unfinished. They can edit every detail and leave without a conclusion.

The brave version is domestic rather than spectacular: the view from a different kitchen, the sound after a conversation one has not had, a chair in a house one might never choose. Avoid predicting outcomes, generating the alleged thoughts of real people, or presenting a possible life as a better one. Material here is labelled imagined and never returns later as biography.

This is a later, optional experiment. It must earn its place by helping people create and reflect, not by making fantasy harder to leave.

### The room that does not know you

Fresh eyes becomes perceptible. Familiar traces and personal motifs are absent. There is an unmarked page, clean light, and no voice referencing who you have been.

The plain retention explanation must accompany the threshold: current Fresh eyes still saves the transcript; it excludes past context and future personalization. “Forget me” or “nothing is saved” would be dishonest names for the existing mode.

There is something artistically powerful in being allowed to stop being a consistent character.

### An edition you can take out of the app

At a time of the writer's choosing, selected traces become a small printable artist's book: folds, exact phrases, blank spaces, dates, and a few images. It is assembled from what the writer selects, with an editable layout. It is not an AI assessment or an automated account of personal growth.

The person leaves with a made thing. They can mark it by hand. The work can continue without the app.

## An art direction with restraint and range

**Materials:** translucent paper, graphite, oxidized silver, ink in water, a small amber edge, interference color visible only at a fold. Warm off-white by day; brown-black and pearl in darkness. Keep the existing literary warmth while giving it actual depth.

**Typography:** words remain crisp even when the world around them changes. Keep the app's serif character for writing and a quiet sans serif for controls. No constantly morphing sentences, illegible handwriting, or decorative text that makes a person fight to read their own words.

**Motion:** a few intelligible physical behaviors—folding, settling, separating, approaching. Let transitions finish. Stillness needs to be an authored state, not the absence of an animation budget. Nothing should punish a person for reading slowly or force them to wait for meaning to become accessible.

**Sound:** start from paper, air, wood, a distant room, a low string. Short compositions with space in them. The writer starts sound, can stop it immediately, and can use the whole work without it. Sonic transformation follows chosen actions. It does not claim to reveal or regulate a nervous system.

**Voice:** ordinary, specific, sparse. “Want to leave those side by side?” is enough. The existing Room prompt already rejects the meditation-narrator register; preserve that restraint. Let the environment carry the poetry.

**Play:** let an object be ridiculous. Let an affectionate phrase make a lopsided fold. Let the writer rename a solemn-looking artifact “the soup incident.” Preserve their register instead of translating every event into reverent self-discovery.

**Variation:** keep a stable physical vocabulary, then let people make strikingly different compositions with it. A system that generates a new spectacular background on every visit will struggle to become a familiar place.

## What I would take off the main stage

- An automatic opening question as the default requirement for entry. Give people a quiet threshold, with a clear way to invite conversation. Keep Talk readily available.
- Ratings, correction-effort forms, and hypothesis administration in the middle of the artistic encounter. Keep useful controls and consent honest and accessible; move optional research interactions to a separate, clearly chosen context.
- A growing cast of personalities as the primary promise. The approved parts design distinguishes the companion's seeded voices from the writer's confirmed parts. Respect that distinction; do not present generated characters as discovered inhabitants of someone's mind.
- Biometric readings as visual truth about the person. These can remain optional tools. They should not become the world's invisible authority.
- Progress metaphors that require a life to improve on schedule: no withered landscape after an absence, locked rooms earned by disclosure, streaks, completion percentages, or implication that revisiting something means failure.

Subtraction is part of the proposal. Adding all of these ideas on top of every existing card would make the app busier and the artwork less legible.

## The boundaries are part of the medium

These follow directly from the proposed interactions, rather than being a separate compliance layer.

1. **Original words, summaries, and fiction remain distinguishable.** Current EchoEngine selects model-distilled `keyMoments`; these cannot silently become exact historical inscriptions. A trace needs an immutable source reference and an explicit author/type.
2. **The writer chooses what becomes durable.** Keeping a trace, excluding a session from personalization, and deleting saved data are different actions with different explanations. An attractive dissolution animation cannot substitute for deletion semantics.
3. **The system never declares that the underside is more true.** A second line is another possibility, not a confession extracted by the interface.
4. **Silence does not become evidence of abandonment or agreement.** The space may settle; the system must not invent a new conclusion about the person because they stopped interacting.
5. **The place does not wait, suffer, or need the writer.** It is a responsive artwork. Returning after months should feel welcome without an invented relationship debt.
6. **Every meaningful gesture has a plain equivalent.** Open the fold, select a distance, view the layers, return. Motion, hearing, fine motor control, and vision are not prerequisites for authorship.
7. **The exit survives every state.** Interruption, reduced motion, loss of connection, and grounding must have authored transitions. During acute-distress handling, the existing safety path takes precedence over immersive spectacle.

## The first experiment I would actually make

Build one small loop:

**Write → lift one sentence → write beneath it → inhabit it → return → optionally keep a trace.**

Use one material system, one optional sound palette, and the existing Journal and Room as starting points. The first prototype can work without generation. Add the companion only where observing the prototype shows that speech adds something.

The accompanying interactive study illustrates this loop with invented sample text. It is a local concept, not connected to a real account; it is not a demonstration of working cloud persistence or of the current app.

### What must be true of a first integrated slice

- A writer can discover the fold without a secret gesture, edit either line, and understand that neither has been labelled more true.
- Entering and leaving Room preserves the document, selected text, cursor, and scroll position, including cancellation and connection failure.
- A visible plain control and keyboard interaction perform every essential operation.
- Only the selected content enters the composition or any optional model request. The memory mode remains explicit throughout.
- An intentionally kept trace reopens to the original words and source. A changed source is versioned; generated interpretations remain separately labelled.
- A person can leave at any moment without a completion ritual or questionnaire.

### What to learn before enlarging it

Watch a small group of willing participants use invented or low-stakes material first. Do not ask them to disclose difficult experiences to validate a design. Ask what they thought the fold meant, whether the spatial changes felt like their choices, and whether anything made them feel interpreted or managed.

Then compare the expressive loop with the same words on a plain page. The question is whether the interaction creates a useful or moving way to encounter the words, not whether people spend longer in the app.

Listen especially for descriptions such as “I could leave it unresolved,” “I wanted to put these together,” or “it felt like something I made.” These are research questions and examples of possible feedback, not results we have measured.

Stop or redesign if the fold consistently feels like the app is trying to expose a hidden truth; if atmosphere overwhelms the writing; if people cannot find the way out; or if preserving the object is more attractive than the experience of making it.

## The sentence I would keep above the workbench

**Make a place where an unfinished experience can remain until your own language catches up with it.**

The magic would come from learning that your words can have another dimension—and that you are the one who decides what goes there.
