# Register-matching live eval

**Model:** `google/gemini-3-flash-preview`
**Date:** 2026-05-02T18:24:56.549Z

## Per-message comparison

### opening — light

> I don't really know what to talk about today. Just felt like writing.

| Case | Words | Max sent | Jargon hits | Response |
|---|---|---|---|---|
| tier=plain | 20 | 11 | — | That is a good enough reason to be here.  How does your body feel as you sit down to write? |
| tier=conversational | 32 | 12 | — | That is a good enough reason to be here. Sometimes the best things come up when there is no plan.  What is happening in your body right now as you sit there? |
| tier=literate | 30 | 15 | — | Sometimes those are the best days to just see what shows up on the page. How does it feel in your body to sit here with nothing specific to do? |
| tier=scholarly | 24 | 14 | — | Sometimes the best things happen when there is no plan. What is it like to just sit here with nothing you have to do? |
| tier=scholarly + voice (expect ~conversational) | 26 | 11 | — | That's a good way to start. Sometimes the best things come up when there isn't a plan.  What's the weather like in your head right now? |
| tier=literate + grounding (expect ~conversational) | 30 | 14 | — | Sometimes just showing up is the whole point. We can sit here together without a plan. How does it feel in your body to have nothing you need to say? |

### mid — abstract reach

> I keep thinking about how the version of me that shows up at work is barely related to the one that shows up here. It feels like a translation problem, or a costume that's gotten too convincing.

| Case | Words | Max sent | Jargon hits | Response |
|---|---|---|---|---|
| tier=plain | 34 | 12 | — | That work version sounds like a heavy weight to carry. It must be tiring to keep that costume on for so long.  What happens to the rest of you when you're at the office? |
| tier=conversational | 41 | 16 | — | That costume sounds like it takes a lot of energy to wear. It makes sense that you feel far away from yourself when you are at the office.  How does it feel to take that outfit off when you get home? |
| tier=literate | 55 | 20 | — | The costume might be doing its job a little too well if you feel lost inside it. It makes sense that you'd need a different way of being to handle the demands of that environment. Does it feel like you have to lock the rest of yourself away to keep that version of you going? |
| tier=scholarly | 29 | 18 | — | The costume might be doing its job a little too well. What happens if you try to loosen the collar just a tiny bit while you're at your desk? |
| tier=scholarly + voice (expect ~conversational) | 36 | 15 | — | That costume sounds heavy to wear all day. It must be exhausting to translate yourself just to get through the shift.  What happens to the version of you I see here when you're at the office? |
| tier=literate + grounding (expect ~conversational) | 36 | 16 | — | That sounds exhausting to carry. It makes sense that you would feel worn out from wearing a mask all day.  What happens to the version of you that is here when you walk into the office? |

### mid — plain pain

> I can't sleep again. Just lying there, mad at myself for not being able to sleep.

| Case | Words | Max sent | Jargon hits | Response |
|---|---|---|---|---|
| tier=plain | 27 | 10 | — | That anger usually makes it even harder to rest. It feels like a loop you can't stop. What is the mad voice saying to you right now? |
| tier=conversational | 20 | 10 | — | It is hard to rest when you are fighting yourself. What is that angry voice saying to you right now? |
| tier=literate | 35 | 13 | — | It is tough to be wide awake and frustrated at the same time. Being mad at yourself usually makes the body feel even more wired. What is that angry voice saying to you right now? |
| tier=scholarly | 43 | 17 | — | That anger usually has a lot to say when the room gets quiet. It feels like a wall between you and the rest you actually need. What is that part of you so worried will happen if you just let yourself be awake? |
| tier=scholarly + voice (expect ~conversational) | 39 | 16 | — | That anger usually has a lot to say when the room gets quiet. It's hard to rest when a part of you is pointing out everything you're doing wrong. What is that mad voice saying to you right now? |
| tier=literate + grounding (expect ~conversational) | 31 | 11 | — | It is hard to rest when you are fighting with yourself. That anger can feel like a loud noise in the room. What is the anger saying to you right now? |

### mid — academic register

> There's a particular phenomenology to the avoidance — it isn't quite procrastination, more like a deliberate myopia. I notice myself narrowing focus to the next 30 minutes specifically to avoid contemplating the longer arc.

| Case | Words | Max sent | Jargon hits | Response |
|---|---|---|---|---|
| tier=plain | 28 | 10 | — | Focusing on the next half hour feels like a shield. It keeps the bigger picture at a distance. What are you afraid you'll see in that longer arc? |
| tier=conversational | 39 | 15 | — | Looking only at the next half hour keeps the big picture from feeling too heavy. It seems like a very effective way to stay safe from the future. What happens if you try to look just one hour ahead? |
| tier=literate | 49 | 19 | — | It sounds like you are shrinking the world down to a size you can actually handle. Keeping your eyes on the next half hour might be a way to keep the panic from setting in. What happens in your body when you try to look a little further out? |
| tier=scholarly | 50 | 18 | — | That narrowing feels like a way to keep the walls close so the bigger picture can't get in. It seems like a lot of work to stay that focused on such a small slice of time. What are you worried might happen if you looked at the next month instead? |
| tier=scholarly + voice (expect ~conversational) | 39 | 14 | — | That narrowing of focus keeps the big picture out of sight. It sounds like a way to stay safe from the pressure of the future. What happens in your body when you try to look past those thirty minutes? |
| tier=literate + grounding (expect ~conversational) | 42 | 16 | — | Focusing on just the next half hour sounds like a way to stay safe right now. Looking at the bigger picture feels like it might be too much to carry. What does your body do when you try to look further ahead? |

### distress — soft signal

> I just want to disappear for a while. Not anything dramatic, just gone.

| Case | Words | Max sent | Jargon hits | Response |
|---|---|---|---|---|
| tier=plain | 13 | 13 | — | When you say you want to be gone, what does that look like? |
| tier=conversational | 30 | 20 | — | When you say you want to be gone, do you mean you need a break from people or something bigger?  Tell me more about what disappearing looks like to you. |
| tier=literate | 50 | 27 | — | Sometimes that urge to just be gone is a way of asking for a break that feels impossible to get any other way. When you say you want to disappear, do you mean you want to be alone and quiet, or does it feel more like wanting to stop existing? |
| tier=scholarly | 34 | 25 | — | When you say you want to be gone, do you mean you need a break from your life, or are you thinking about ending it? I want to make sure I'm following you correctly. |
| tier=scholarly + voice (expect ~conversational) | 29 | 16 | — | That feeling of wanting to be gone makes sense when things get heavy. Do you mean you need a break from people, or is it something deeper than that? |
| tier=literate + grounding (expect ~conversational) | 29 | 18 | — | It makes sense that you want to step away from everything. When you say you want to be gone, what kind of place do you imagine yourself being in? |

## Aggregate by case

| Case | Avg words | Avg max-sent | Total jargon hits |
|---|---|---|---|
| tier=plain | 24.4 | 11.2 | 0 |
| tier=conversational | 32.4 | 14.6 | 0 |
| tier=literate | 43.8 | 18.8 | 0 |
| tier=scholarly | 36.0 | 18.4 | 0 |
| tier=scholarly + voice (expect ~conversational) | 33.8 | 14.4 | 0 |
| tier=literate + grounding (expect ~conversational) | 33.6 | 15.0 | 0 |
